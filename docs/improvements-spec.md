# Kysera improvements: Спецификация архитектурных улучшений

## Исполнительное резюме

Данный документ представляет критический синтез аудита архитектуры Kysera и формулирует спецификацию улучшений, направленных на достижение трёх ключевых целей:

1. **Предельная производительность** — минимальный runtime overhead, tree-shaking, zero-cost abstractions
2. **Предельная продуктивность** — type inference, functional composition, minimal boilerplate
3. **Инновационность** — Functional DAL, Vertical Slice support, validation-agnostic design

---

## Часть 1: Анализ критики и её валидность

### 1.1 Матрица валидности критических замечаний

| Критика | Валидность | Обоснование | Приоритет |
|---------|------------|-------------|-----------|
| **SRP нарушение в core** | ✓ ВАЛИДНО | health.ts: 632 строки, 5+ concerns; testing.ts: 329 строк dev-only кода | CRITICAL |
| **Инфра-утилиты в ORM** | ✓ ВАЛИДНО | Health, Retry, Circuit Breaker — не ответственность ORM | HIGH |
| **Vendor lock-in Zod** | ✓ ВАЛИДНО | `z.ZodType` жёстко вшит в интерфейсы; нет абстракции | HIGH |
| **Repository vs Functional** | ~ ЧАСТИЧНО | Repository уже функциональный (не классы), но нет явного Functional DAL API | MEDIUM |
| **Размер core 24KB** | ✓ ВАЛИДНО | health.ts=18KB, testing.ts=8.9KB; после рефакторинга: -46% | MEDIUM |
| **70 error codes — burden** | ~ ЧАСТИЧНО | Maintenance реален, но унификация необходима; нужен escape hatch | LOW |
| **Prisma PSL кросс-язык** | ✗ НЕВАЛИДНО | Kysera — TypeScript-only by design; это не недостаток | — |

### 1.2 Текущее распределение кода в @kysera/core

```
Модуль              Строк   %      Категория
─────────────────────────────────────────────
health.ts           632    27%    ИНФРАСТРУКТУРА (5+ concerns!)
testing.ts          329    14%    DEV-ONLY (не production)
error-codes.ts      303    13%    ЯДРО (error system)
pagination.ts       277    12%    ЯДРО (data access)
errors.ts           245    11%    ЯДРО (error classes)
debug.ts            241    10%    ИНФРАСТРУКТУРА (profiling)
retry.ts            147     6%    ИНФРАСТРУКТУРА (resilience)
shutdown.ts          58     2%    ИНФРАСТРУКТУРА
types.ts             44     2%    ЯДРО (utilities)
logger.ts            42     2%    ЯДРО (interface)
index.ts             11     0%    —
─────────────────────────────────────────────
ВСЕГО              2329   100%

ЯДРО:               869    37%    → Остаётся в core
ИНФРАСТРУКТУРА:    1078    46%    → Выносится в @kysera/infra
DEV-ONLY:           329    14%    → Выносится в @kysera/testing
```

### 1.3 Критические нарушения SRP в health.ts

```
health.ts (632 строки) содержит 5+ независимых ответственностей:

1. Pool Metrics Extraction (60 строк)
   ├── PostgreSQL pool detection
   ├── MySQL pool detection
   └── SQLite detection + fallback

2. Health Check Execution (70 строк)
   └── Database connectivity test

3. Metrics Calculation (90 строк)
   ├── Query aggregation
   ├── Percentile calculations
   └── Recommendations

4. Health Monitoring (50 строк)
   └── HealthMonitor class (interval-based)

5. Legacy Compatibility (65 строк)
   └── Deprecated functions
```

---

## Часть 2: Архитектурные решения

### 2.1 Новая структура пакетов

```
@kysera/core.                 ~500 строк, ~8KB
├── types.ts                  Executor, Timestamps, utility types
├── errors.ts                 DatabaseError hierarchy
├── error-codes.ts            Unified error codes (simplified)
├── pagination.ts             Offset & cursor pagination
└── logger.ts                 KyseraLogger interface

@kysera/infra (NEW)           ~800 строк, ~12KB
├── health/
│   ├── check.ts              checkDatabaseHealth()
│   ├── monitor.ts            HealthMonitor class
│   └── metrics.ts            getMetrics(), MetricsResult
├── resilience/
│   ├── retry.ts              withRetry(), RetryOptions
│   └── circuit-breaker.ts    CircuitBreaker class
├── shutdown.ts               gracefulShutdown()
└── pool/
    └── metrics.ts            createMetricsPool() (DB-specific)

@kysera/testing (NEW)         ~350 строк, ~6KB
├── transaction.ts            testInTransaction(), testWithSavepoints()
├── cleanup.ts                cleanDatabase()
├── factories.ts              createFactory()
├── seeding.ts                seedDatabase()
└── helpers.ts                waitFor(), snapshotTable()

@kysera/debug (NEW)           ~250 строк, ~5KB
├── plugin.ts                 DebugPlugin for Kysely
├── profiler.ts               QueryProfiler
└── format.ts                 formatSQL()

@kysera/dal (NEW)             ~400 строк, ~7KB    ← ИННОВАЦИЯ
├── query.ts                  createQuery(), infer types
├── context.ts                DbContext, withTransaction
├── compose.ts                Query composition helpers
└── types.ts                  InferResult, InferInput

@kysera/repository            ~1100 строк, ~15KB
├── (existing modules)
├── validation/
│   ├── adapter.ts            ValidationSchema interface (NEW)
│   ├── zod.ts                Zod adapter
│   └── native.ts             Native TS validation
└── dal-integration.ts        Bridge to @kysera/dal
```

### 2.2 Миграционный путь

```
@kysera/core@1.x (current)
    │
    ├─→ @kysera/core@2.x        (minimal core)
    ├─→ @kysera/infra           (health, retry, shutdown)
    ├─→ @kysera/testing         (dev utilities)
    └─→ @kysera/debug           (query profiling)

Backward compatibility:
@kysera/compat                  Re-exports всего из core@1.x
```

---

## Часть 3: Functional DAL — Новый подход

### 3.1 Концепция

Functional DAL (Data Access Layer) — альтернативный API, основанный на:
- **Query functions** вместо Repository methods
- **Type inference** вместо явных DTO
- **Context passing** вместо DI containers
- **Colocation** — код рядом с местом использования

### 3.2 API Design

```typescript
// @kysera/dal

import { createQuery, DbContext, withTransaction } from '@kysera/dal';
import { db } from './db';

// ─────────────────────────────────────────────────────────────
// 1. Query Functions с автоматическим выводом типов
// ─────────────────────────────────────────────────────────────

// Тип результата выводится АВТОМАТИЧЕСКИ из select()
export const getUserById = createQuery(
  (ctx: DbContext, id: number) =>
    ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'name'])  // ← Тип: { id: number; email: string; name: string }
      .where('id', '=', id)
      .executeTakeFirst()
);

// Использование
const user = await getUserById(db, 1);
//    ^? { id: number; email: string; name: string } | undefined

// ─────────────────────────────────────────────────────────────
// 2. Context Passing для транзакций
// ─────────────────────────────────────────────────────────────

export const createUserWithProfile = async (
  ctx: DbContext,
  userData: { email: string; name: string },
  profileData: { bio: string }
) => {
  // Внутри транзакции ctx.db — это Transaction<DB>
  const user = await ctx.db
    .insertInto('users')
    .values(userData)
    .returningAll()
    .executeTakeFirstOrThrow();

  const profile = await ctx.db
    .insertInto('profiles')
    .values({ user_id: user.id, ...profileData })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { user, profile };
};

// Использование с транзакцией
const result = await withTransaction(db, (ctx) =>
  createUserWithProfile(ctx,
    { email: 'test@example.com', name: 'Test' },
    { bio: 'Hello!' }
  )
);

// ─────────────────────────────────────────────────────────────
// 3. Composition — объединение query functions
// ─────────────────────────────────────────────────────────────

import { compose, parallel } from '@kysera/dal';

// Последовательное выполнение
const getUserWithPosts = compose(
  getUserById,
  async (ctx, user) => ({
    ...user,
    posts: await getPostsByUserId(ctx, user.id)
  })
);

// Параллельное выполнение
const getDashboardData = parallel({
  user: getUserById,
  stats: getUserStats,
  notifications: getNotifications
});

const dashboard = await getDashboardData(ctx, userId);
//    ^? { user: User; stats: Stats; notifications: Notification[] }
```

### 3.3 Сравнение: Repository vs Functional DAL

```typescript
// ═══════════════════════════════════════════════════════════════
// REPOSITORY PATTERN (existing)
// ═══════════════════════════════════════════════════════════════

const factory = createRepositoryFactory(db);

const userRepo = factory.create<'users', User, number>({
  tableName: 'users',
  primaryKey: 'id',
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at
  }),
  schemas: {
    create: CreateUserSchema,
    update: UpdateUserSchema
  }
});

// Получить пользователя
const user = await userRepo.findById(1);

// В транзакции
await db.transaction().execute(async (trx) => {
  const txRepo = factory.create<'users', User, number>({ /* config */ });
  // Нужно пересоздавать репозиторий
  await txRepo.create({ email: '...', name: '...' });
});

// ═══════════════════════════════════════════════════════════════
// FUNCTIONAL DAL (new)
// ═══════════════════════════════════════════════════════════════

// Определение query функций
const getUserById = createQuery((ctx, id: number) =>
  ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
);

const createUser = createQuery((ctx, data: CreateUserInput) =>
  ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
);

// Получить пользователя (тип выводится автоматически!)
const user = await getUserById(db, 1);

// В транзакции — тот же код!
await withTransaction(db, async (ctx) => {
  await createUser(ctx, { email: '...', name: '...' });
  // ctx.db уже транзакция, ничего пересоздавать не нужно
});
```

### 3.4 Когда использовать что

| Сценарий | Repository | Functional DAL |
|----------|------------|----------------|
| CRUD операции с валидацией | ✓ Лучше | ○ Подходит |
| Сложные кастомные запросы | ○ Ограничен | ✓ Лучше |
| Транзакции с несколькими таблицами | ○ Verbose | ✓ Лучше |
| Vertical Slice Architecture | ✗ Не подходит | ✓ Идеально |
| Команды без SQL-опыта | ✓ Лучше | ○ Требует SQL |
| Tree-shaking критичен | ○ Средне | ✓ Отлично |
| Максимальный inference | ○ Средне | ✓ Отлично |

---

## Часть 4: Validation Adapter — Устранение Zod lock-in

### 4.1 Абстрактный интерфейс

```typescript
// @kysera/repository/validation/adapter.ts

/**
 * Generic validation schema interface.
 * Совместим с Zod, Valibot, TypeBox, io-ts, и native TS.
 */
export interface ValidationSchema<T> {
  /**
   * Parse and validate data. Throws on error.
   */
  parse(data: unknown): T;

  /**
   * Safe parse without throwing.
   */
  safeParse(data: unknown): ValidationResult<T>;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: ValidationError;
}

export interface ValidationError {
  message: string;
  path?: (string | number)[];
  issues?: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  path: (string | number)[];
}
```

### 4.2 Адаптеры для популярных библиотек

```typescript
// ─────────────────────────────────────────────────────────────
// Zod Adapter (default)
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';

export function zodAdapter<T>(schema: z.ZodType<T>): ValidationSchema<T> {
  return {
    parse: (data) => schema.parse(data),
    safeParse: (data) => {
      const result = schema.safeParse(data);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return {
        success: false,
        error: {
          message: result.error.message,
          issues: result.error.issues.map(i => ({
            code: i.code,
            message: i.message,
            path: i.path
          }))
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Valibot Adapter
// ─────────────────────────────────────────────────────────────
import * as v from 'valibot';

export function valibotAdapter<T>(schema: v.BaseSchema<T>): ValidationSchema<T> {
  return {
    parse: (data) => v.parse(schema, data),
    safeParse: (data) => {
      const result = v.safeParse(schema, data);
      if (result.success) {
        return { success: true, data: result.output };
      }
      return {
        success: false,
        error: {
          message: 'Validation failed',
          issues: result.issues.map(i => ({
            code: i.type,
            message: i.message,
            path: i.path?.map(p => p.key) ?? []
          }))
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────
// TypeBox Adapter
// ─────────────────────────────────────────────────────────────
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export function typeboxAdapter<T>(schema: TSchema): ValidationSchema<T> {
  return {
    parse: (data) => {
      if (!Value.Check(schema, data)) {
        const errors = [...Value.Errors(schema, data)];
        throw new Error(errors[0]?.message ?? 'Validation failed');
      }
      return data as T;
    },
    safeParse: (data) => {
      if (Value.Check(schema, data)) {
        return { success: true, data: data as T };
      }
      const errors = [...Value.Errors(schema, data)];
      return {
        success: false,
        error: {
          message: errors[0]?.message ?? 'Validation failed',
          issues: errors.map(e => ({
            code: 'type_error',
            message: e.message,
            path: e.path.split('/').filter(Boolean)
          }))
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Native TypeScript (no runtime validation)
// ─────────────────────────────────────────────────────────────
export function nativeAdapter<T>(): ValidationSchema<T> {
  return {
    parse: (data) => data as T,
    safeParse: (data) => ({ success: true, data: data as T })
  };
}
```

### 4.3 Использование в Repository

```typescript
// До (Zod lock-in)
const userRepo = factory.create<'users', User, number>({
  schemas: {
    create: CreateUserSchema,  // ← z.ZodType required
    update: UpdateUserSchema
  }
});

// После (любая библиотека)
import { zodAdapter, valibotAdapter, nativeAdapter } from '@kysera/repository';

// С Zod (по умолчанию)
const userRepo = factory.create<'users', User, number>({
  schemas: {
    create: zodAdapter(CreateUserSchema),
    update: zodAdapter(UpdateUserSchema)
  }
});

// С Valibot
const userRepo = factory.create<'users', User, number>({
  schemas: {
    create: valibotAdapter(CreateUserSchema),
    update: valibotAdapter(UpdateUserSchema)
  }
});

// Без runtime валидации (только TypeScript)
const userRepo = factory.create<'users', User, number>({
  schemas: {
    create: nativeAdapter<CreateUserInput>(),
    update: nativeAdapter<UpdateUserInput>()
  }
});

// Auto-detection (backward compatible)
const userRepo = factory.create<'users', User, number>({
  schemas: {
    create: CreateUserSchema,  // Автоматически обёрнуто в zodAdapter
    update: UpdateUserSchema
  }
});
```

---

## Часть 5: Vertical Slice Architecture Support

### 5.1 Рекомендуемая структура проекта

```
src/
├── shared/                      # Инфраструктурный слой
│   ├── db/
│   │   ├── client.ts            # Kysely instance
│   │   ├── types.ts             # Generated DB types
│   │   └── context.ts           # DbContext from @kysera/dal
│   └── lib/
│       └── errors.ts            # Application errors
│
├── modules/                     # Бизнес-модули (Vertical Slices)
│   ├── users/
│   │   ├── api/                 # PUBLIC INTERFACE
│   │   │   ├── index.ts         # Публичные экспорты
│   │   │   └── types.ts         # Публичные типы
│   │   ├── internal/            # PRIVATE IMPLEMENTATION
│   │   │   ├── queries/         # Query functions (Functional DAL)
│   │   │   │   ├── find-user.ts
│   │   │   │   ├── create-user.ts
│   │   │   │   └── index.ts
│   │   │   ├── domain/          # Business logic + validation
│   │   │   │   └── user.schema.ts
│   │   │   └── use-cases/       # Orchestration
│   │   │       ├── register-user.ts
│   │   │       └── update-profile.ts
│   │   └── index.ts             # Module barrel (re-exports api/)
│   │
│   └── billing/
│       ├── api/ ...
│       ├── internal/ ...
│       └── index.ts
│
└── app/                         # Application layer
    ├── server.ts
    └── routes.ts
```

### 5.2 ESLint правила для Module Boundaries

```javascript
// eslint.config.js
import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'module-api', pattern: 'src/modules/*/api/**' },
        { type: 'module-internal', pattern: 'src/modules/*/internal/**' },
        { type: 'app', pattern: 'src/app/**' }
      ]
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // shared может импортировать только shared
            { from: 'shared', allow: ['shared'] },

            // module-internal может импортировать shared и свой api
            { from: 'module-internal', allow: ['shared', 'module-api'] },

            // module-api может импортировать shared
            { from: 'module-api', allow: ['shared'] },

            // app может импортировать shared и module-api
            { from: 'app', allow: ['shared', 'module-api'] },

            // ЗАПРЕЩЕНО: импорт internal других модулей
            // ❌ import { ... } from '@/modules/users/internal/queries'
          ]
        }
      ],
      'boundaries/no-private': [
        'error',
        {
          allowUncles: false  // Запретить доступ к internal родственных модулей
        }
      ]
    }
  }
];
```

### 5.3 Пример модуля с Functional DAL

```typescript
// ═══════════════════════════════════════════════════════════════
// src/modules/users/internal/queries/find-user.ts
// ═══════════════════════════════════════════════════════════════
import { createQuery, type DbContext } from '@kysera/dal';

// Приватный query — не экспортируется из модуля
export const findUserById = createQuery(
  (ctx: DbContext, id: number) =>
    ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst()
);

export const findUserByEmail = createQuery(
  (ctx: DbContext, email: string) =>
    ctx.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst()
);

// ═══════════════════════════════════════════════════════════════
// src/modules/users/internal/use-cases/register-user.ts
// ═══════════════════════════════════════════════════════════════
import { withTransaction, type DbContext } from '@kysera/dal';
import { findUserByEmail } from '../queries/find-user';
import { insertUser } from '../queries/create-user';
import { RegisterUserSchema } from '../domain/user.schema';
import { db } from '@/shared/db/client';

export interface RegisterUserInput {
  email: string;
  name: string;
  password: string;
}

export const registerUser = async (input: RegisterUserInput) => {
  // 1. Валидация
  const validated = RegisterUserSchema.parse(input);

  // 2. Транзакция
  return withTransaction(db, async (ctx) => {
    // 3. Проверка существующего пользователя
    const existing = await findUserByEmail(ctx, validated.email);
    if (existing) {
      throw new Error('Email already registered');
    }

    // 4. Создание пользователя
    const user = await insertUser(ctx, {
      email: validated.email,
      name: validated.name,
      password_hash: await hashPassword(validated.password)
    });

    return { id: user.id, email: user.email };
  });
};

// ═══════════════════════════════════════════════════════════════
// src/modules/users/api/index.ts (PUBLIC INTERFACE)
// ═══════════════════════════════════════════════════════════════
// Экспортируем ТОЛЬКО use-cases, не queries!
export { registerUser } from '../internal/use-cases/register-user';
export { updateProfile } from '../internal/use-cases/update-profile';

// Публичные типы
export type { RegisterUserInput } from '../internal/use-cases/register-user';
export type { UserPublicProfile } from './types';

// ═══════════════════════════════════════════════════════════════
// src/modules/users/index.ts (MODULE BARREL)
// ═══════════════════════════════════════════════════════════════
export * from './api';
```

---

## Часть 6: Производительность и метрики

### 6.1 Целевые метрики

| Метрика | текущий | цель | Улучшение |
|---------|----------------|-------------|-----------|
| **@kysera/core size** | 24KB | 8KB | -67% |
| **Full stack size** | 64KB | 50KB | -22% |
| **Tree-shaking efficiency** | ~70% | ~95% | +25pp |
| **Type check time (10 entities)** | baseline | -20% | — |
| **Cold start (Lambda)** | baseline | -30% | — |
| **Runtime overhead** | ~5% | ~2% | -60% |

### 6.2 Bundle Analysis

```
current Distribution:
@kysera/core           24KB (37%)   ← Bloated
@kysera/repository     12KB (19%)
@kysera/soft-delete     4KB (6%)
@kysera/audit           8KB (12%)
@kysera/timestamps      4KB (6%)
@kysera/migrations     12KB (19%)
───────────────────────────────────
TOTAL                  64KB

next Distribution (projected):
@kysera/core            8KB (16%)   ← Minimal
@kysera/infra          12KB (24%)   ← Opt-in
@kysera/testing         6KB (12%)   ← Dev-only
@kysera/debug           5KB (10%)   ← Opt-in
@kysera/dal             7KB (14%)   ← NEW
@kysera/repository     12KB (24%)
───────────────────────────────────
CORE ONLY               8KB         ← -67%
FULL STACK             50KB         ← -22%
```

### 6.3 Tree-shaking демонстрация

```typescript
// До: импорт всего
import { createRepositoryFactory, checkDatabaseHealth, withRetry } from '@kysera/core';
// → 24KB в бандле

// После: гранулярный импорт
import { createRepositoryFactory } from '@kysera/repository';  // 12KB
import { checkDatabaseHealth } from '@kysera/infra/health';    // 3KB (если нужен)
import { withRetry } from '@kysera/infra/resilience';          // 2KB (если нужен)
// → 12-17KB в бандле (в зависимости от использования)

// Functional DAL (максимальный tree-shake)
import { createQuery, withTransaction } from '@kysera/dal';    // 3KB
// → Только то, что используется
```

---

## Часть 7: План реализации

### 7.1 Фазы разработки

```
Phase 1: Package Restructuring (2 недели)
├── Создание @kysera/testing (extract из core)
├── Создание @kysera/infra (extract из core)
├── Создание @kysera/debug (extract из core)
├── Минимизация @kysera/core
└── Backward-compatible @kysera/compat

Phase 2: Validation Adapter (1 неделя)
├── ValidationSchema interface
├── Zod adapter (default)
├── Valibot adapter
├── TypeBox adapter
├── Native (no-op) adapter
└── Auto-detection для backward compatibility

Phase 3: Functional DAL (2 недели)
├── createQuery() с type inference
├── DbContext и withTransaction()
├── compose() и parallel()
├── Integration с @kysera/repository
└── Documentation и examples

Phase 4: Vertical Slice Support (1 неделя)
├── ESLint plugin для boundaries
├── Project templates
├── CLI scaffolding (optional)
└── Best practices documentation

Phase 5: Testing & Documentation (1 неделя)
├── Performance benchmarks
├── API documentation
└── Example projects
```

---

## Часть 8: Резюме и выводы

### 8.1 Ключевые архитектурные решения

1. **Разделение ответственностей**: Core содержит только data access utilities; инфраструктура выносится в отдельные пакеты

2. **Validation-agnostic**: Абстрактный ValidationSchema interface позволяет использовать любую библиотеку валидации

3. **Dual API**: Repository pattern для CRUD + Functional DAL для complex queries и vertical slices

4. **Module boundaries**: ESLint правила для enforcement архитектурных границ

5. **Opt-in complexity**: Minimal core по умолчанию; инфраструктура подключается по необходимости

### 8.2 Ответы на критику аудита

| Критика | Решение |
|---------|----------------|
| SRP нарушение | health.ts разбит на 3 модуля; testing вынесен |
| Инфра в ORM | @kysera/infra — отдельный opt-in пакет |
| Zod lock-in | ValidationSchema adapter pattern |
| Repository vs Functional | @kysera/dal — Functional DAL альтернатива |
| Размер 24KB | Core уменьшен до 8KB (-67%) |
| Bloatware под маской модульности | Истинная модульность через package separation |

### 8.3 Инновационные преимущества

1. **Type Inference First**: Functional DAL выводит типы автоматически из SQL-запросов

2. **Zero-Config Transactions**: Context passing вместо UnitOfWork/DI

3. **Vertical Slice Native**: Архитектура изначально поддерживает feature-based организацию

4. **Validation Freedom**: Первый TypeScript ORM с validation-agnostic design

5. **Minimal by Default**: 8KB core достаточен для большинства use cases

---

## Приложения

### A. Полный API Reference @kysera/dal

```typescript
// Query creation
function createQuery<Args, Result>(
  queryFn: (ctx: DbContext, ...args: Args) => Promise<Result>
): QueryFunction<Args, Result>;

// Context types
interface DbContext<DB = any> {
  db: Kysely<DB> | Transaction<DB>;
  isTransaction: boolean;
}

// Transaction execution
function withTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (ctx: DbContext<DB>) => Promise<T>,
  options?: TransactionOptions
): Promise<T>;

// Composition
function compose<A, B, C>(
  first: QueryFunction<A, B>,
  second: (ctx: DbContext, result: B) => Promise<C>
): QueryFunction<A, C>;

function parallel<T extends Record<string, QueryFunction>>(
  queries: T
): ParallelQueryFunction<T>;

// Type inference helpers
type InferResult<Q> = Q extends QueryFunction<any, infer R> ? R : never;
type InferArgs<Q> = Q extends QueryFunction<infer A, any> ? A : never;
```

### B. Migration Checklist current → next

```markdown
[ ] Update package.json dependencies
    - Add @kysera/infra if using health/retry/shutdown
    - Add @kysera/testing if using test utilities
    - Add @kysera/debug if using query profiling

[ ] Update imports
    - Health utilities: @kysera/core → @kysera/infra
    - Testing utilities: @kysera/core → @kysera/testing
    - Debug utilities: @kysera/core → @kysera/debug

[ ] Update validation schemas (optional)
    - Wrap in zodAdapter() for explicit typing
    - Or keep as-is for auto-detection

[ ] Consider Functional DAL for new code
    - Replace complex repository methods with query functions
    - Use withTransaction() for multi-table operations

[ ] Review ESLint config
    - Add boundaries plugin for module isolation
    - Configure element types for your project structure
```

---

*Документ подготовлен: Декабрь 2025*
*Версия: 2.0-spec-draft*
*Статус: Для review и утверждения*
