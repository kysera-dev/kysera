# Зачем миру ещё одна TypeScript ORM: инженерный анализ экосистемы и обоснование создания Kysera

## Введение

В экосистеме TypeScript для работы с базами данных существует множество решений: от низкоуровневых query builder'ов до полноценных ORM с богатой функциональностью. Почему же при таком разнообразии возникает потребность в создании нового инструмента? Этот вопрос требует честного и критического анализа существующих решений, их ограничений и архитектурных компромиссов.

Данная статья представляет собой инженерный анализ ландшафта TypeScript ORM/query builder решений на конец 2024 — начало 2025 года, основанный на исследовании исходного кода, документации, бенчмарков и реальных проблем, с которыми сталкиваются разработчики.

---

## Часть 1: Критический анализ существующих решений

### 1.1 Prisma: когда удобство стоит дорого

**Архитектура и трансформация**

Prisma долгое время была эталоном developer experience в мире TypeScript ORM. Однако её архитектурные решения несли серьёзные издержки. До версии 6.16 (сентябрь 2025) Prisma использовала Rust-based query engine, что приводило к:

- **Размер бандла: ~14MB** (~7MB в сжатом виде)
- **Зависимость от нативных бинарников**, что создавало проблемы в serverless-окружениях и браузерных IDE (StackBlitz)
- **Издержки сериализации** между Rust и JavaScript, которые нивелировали преимущества производительности Rust

В 2024-2025 годах Prisma предприняла радикальный шаг — переход на TypeScript/WASM-based «Query Compiler», что позволило сократить размер до **~1.6MB** (600KB gzipped) и ускорить запросы до **3.4x** для больших датасетов.

**Сохраняющиеся ограничения**

Несмотря на улучшения, фундаментальные ограничения Prisma остаются:

1. **Проприетарный Schema Language (PSL)**: Prisma требует описания схемы в собственном формате `.prisma`, что:
   - Не позволяет использовать внешние JavaScript/TypeScript библиотеки в логике сущностей
   - Создаёт дополнительный слой абстракции между кодом и базой данных
   - Требует отдельного этапа генерации типов (`prisma generate`)

2. **Ограничения в сложных запросах**:
   - Не поддерживает `include/select` в сценариях группировки
   - `$queryRaw` не оптимизирован — валидный SQL иногда не выполняется
   - Может выполнять несколько запросов к БД вместо одного JOIN

3. **Объём нерешённых issues**: Команда Prisma признаёт наличие большого backlog, таргетируя 38+ issues в квартал (ранее было 5)

**Когда Prisma подходит**: Быстрое прототипирование, команды без глубокого знания SQL, проекты с простой доменной моделью.

**Когда Prisma не подходит**: Сложные аналитические запросы, требования к минимальному размеру бандла, необходимость полного контроля над SQL.

---

### 1.2 TypeORM: legacy с uncertain future

**Состояние проекта**

TypeORM — один из старейших TypeScript ORM, использующий паттерны Active Record и Data Mapper с декораторами. Однако в 2024-2025 годах проект демонстрирует тревожные признаки:

- Разработчики сообщества характеризуют проект как «full of confusing/obscure/unpredictable/broken parts»
- Медленный roadmap и ограниченная активность мейнтейнеров
- Метафора из сообщества: «driving a luxury car with flat tires»

**Проблемы типизации**

Несмотря на позиционирование как TypeScript-first ORM, TypeORM имеет серьёзные проблемы с типами:

1. **Несогласованность типов**: Отсутствует статический анализ на соответствие типов и декораторов
2. **Confusing nullability**: Отношения nullable по умолчанию, колонки — нет
3. **Verbose синтаксис**: Простая nullable колонка требует `@Column({ type: "string", nullable: true })` вместо `string | null`
4. **Устаревшие декораторы**: Требует `experimentalDecorators: true` и `emitDecoratorMetadata: true`

**Решения сообщества**: ESLint-плагин `eslint-plugin-typeorm-typescript` частично решает проблему, но это костыль, а не системное решение.

**Производительность**: TypeORM известен проблемами с производительностью на масштабных проектах.

**Вердикт**: TypeORM остаётся в проектах по причине legacy-зависимостей, но для новых проектов это сомнительный выбор.

---

### 1.3 Drizzle ORM: взрывной рост и скрытые проблемы

**Впечатляющие метрики**

Drizzle ORM продемонстрировал феноменальный рост в 2024 году:
- Еженедельные загрузки: 110K → 710K (+545%)
- GitHub stars: +10,200 (+67%)
- Команда: 3 part-time → 13 full-time разработчиков

**Архитектурные преимущества**

1. **SQL-first подход**: Схема описывается в TypeScript, напоминая `CREATE TABLE`
2. **Минимальный размер**: ~7.4KB (minified + gzipped)
3. **Zero dependencies**: Нет внешних зависимостей
4. **Лучший для serverless**: Быстрейший cold start

**Скрытые проблемы**

При детальном анализе обнаруживаются серьёзные issues:

1. **Типизация не полностью безопасна**:
   > «Only query results have type information. You can write invalid queries with Drizzle.»

   Drizzle создаёт *впечатление* type safety, но позволяет писать некорректные запросы.

2. **Производительность type checking**: На **72% медленнее Prisma** — типы выводятся в реальном времени TypeScript-компилятором, а не pre-computed как в Prisma.

3. **Состояние проекта (данные из GitHub issue #4391)**:
   - 1,378 открытых issues
   - 560 помечены как «priority»
   - 250 открытых PR
   - Критические баги (например, `$count`) не решаются месяцами
   - Минимальная реакция команды на issues

4. **Документация**: «Awesome ORM with awful documentation» — частый отзыв разработчиков.

5. **Closed-source компоненты**: Drizzle Kit не был open-source, что ограничивало community contributions.

**Вердикт**: Drizzle — отличный выбор для serverless и edge computing, но требует осторожности в сложных проектах из-за неполной type safety и проблем с поддержкой.

---

### 1.4 Kysely: идеальный query builder без ORM-функциональности

**Архитектура**

Kysely — type-safe SQL query builder, вдохновлённый Knex.js. Его философия: «If you know SQL, you know Kysely».

**Сильные стороны**

1. **Zero runtime overhead**: Типы существуют только во время компиляции
2. **Zero dependencies**: Никаких внешних зависимостей
3. **Отличная cross-runtime поддержка**: Node.js, Deno, Bun, Cloudflare Workers

**Ограничения**

1. **Только query builder**: Kysely не предоставляет:
   - Repository pattern
   - Систему миграций
   - Плагины (soft delete, audit, timestamps)
   - Health checks и graceful shutdown
   - Утилиты тестирования

2. **Ручное управление типами схемы**: Необходимо вручную поддерживать синхронизацию TypeScript-типов с реальной схемой БД. Решение — `kysely-codegen`, но это дополнительный инструмент.

3. **Сложные типы могут перегрузить TypeScript**:
   - Ошибки «Type instantiation is excessively deep and possibly infinite»
   - Необходимость использовать `$assertType` для упрощения типов
   - `$if` метод негативно влияет на производительность TypeScript

**Вердикт**: Kysely — превосходный query builder для тех, кто хочет писать типизированный SQL. Однако для production-приложений требуется значительный объём boilerplate-кода для реализации стандартных ORM-функций.

---

### 1.5 Knex.js: ветеран с устаревшей типизацией

**История**

Knex.js — один из оригинальных JavaScript query builder'ов, созданный 13 лет назад. Впечатляющая статистика:
- ~10M загрузок в месяц
- 614 контрибьюторов
- 3.08K коммитов

**Проблема типизации**

TypeScript-поддержка Knex.js описывается как «best-effort»:
- Не все паттерны использования могут быть типизированы
- Гибкий API затрудняет полную type safety
- Отсутствие типизации не гарантирует корректность запросов

**Альтернатива**: `typed-knex` — сторонняя обёртка с полной типизацией, но покрывает только ~80% use cases.

**Вердикт**: Knex.js остаётся жизнеспособным выбором для существующих проектов, но слабая типизация делает его неоптимальным для новых TypeScript-проектов.

---

### 1.6 MikroORM: enterprise-grade с высоким порогом входа

**Архитектура**

MikroORM реализует проверенные паттерны:
- **Data Mapper**: Разделение бизнес-логики и persistence
- **Unit of Work**: Координация записи изменений
- **Identity Map**: Гарантия уникальности сущностей в контексте

**Сильные стороны**

1. **Sophisticated transaction handling**: Автоматические транзакции через `em.flush()`
2. **Batched queries**: Оптимизация через Unit of Work
3. **Rich feature set**: Filters, lifecycle hooks, cascading, composite keys

**Ограничения**

1. **Сложность**: Высокий порог входа для простых CRUD-операций
2. **Множество зависимостей**: В отличие от minimalist-решений
3. **Размер**: Значительный footprint для микросервисов

**Вердикт**: MikroORM — отличный выбор для сложных enterprise-приложений с rich domain model, но избыточен для простых сервисов.

---

## Часть 2: Проблема «золотой середины»

### 2.1 Спектр решений

Анализ существующих решений выявляет спектр:

```
Низкий уровень                                    Высокий уровень
├─────────────────────────────────────────────────────────────────┤
Knex.js → Kysely → Drizzle → Kysera → Prisma → TypeORM → MikroORM
 (QB)      (QB)    (ORM)     (?)      (ORM)    (ORM)     (ORM)
```

**Наблюдение**: Существует разрыв между:
- **Query builders** (Kysely, Knex): Минимальные, типизированные, но требуют много boilerplate
- **Полноценные ORM** (Prisma, TypeORM, MikroORM): Feature-rich, но тяжёлые, с ограничениями

### 2.2 Типичные потребности production-приложения

Для большинства backend-сервисов требуется:

1. **Type-safe запросы** — без «any», с автокомплитом
2. **Repository pattern** — абстракция над таблицами
3. **Валидация** — runtime-проверка входных данных
4. **Soft delete** — логическое удаление
5. **Audit logging** — отслеживание изменений
6. **Health checks** — мониторинг состояния БД
7. **Migrations** — версионирование схемы
8. **Graceful shutdown** — корректное завершение
9. **Retry logic** — устойчивость к transient-ошибкам
10. **Multi-database support** — PostgreSQL, MySQL, SQLite

### 2.3 Существующие варианты

| Решение | Type Safety | Repository | Soft Delete | Audit | Health | Migrations | Bundle Size |
|---------|------------|------------|-------------|-------|--------|------------|-------------|
| Kysely | ✓✓✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ~0 |
| Drizzle | ✓✓ | ✗ | ✗ | ✗ | ✗ | ✓ | 7.4KB |
| Prisma | ✓✓✓ | ✗* | ✗ | ✗ | ✗ | ✓ | 1.6MB |
| TypeORM | ✓ | ✓ | ✓** | ✗ | ✗ | ✓ | Medium |
| MikroORM | ✓✓✓ | ✓ | ✓ | ✗ | ✗ | ✓ | Large |

*Prisma использует собственную абстракцию вместо традиционного Repository pattern
**TypeORM soft delete имеет известные issues

**Вывод**: Ни одно решение не предоставляет полный набор production-ready функций с минимальным размером и максимальной type safety.

---

## Часть 3: Позиционирование Kysera

### 3.1 Философия

Kysera занимает нишу между raw Kysely и тяжёлыми ORM:

> **«Minimal core, optional everything»**
> — Ядро минимально, всё остальное опционально

Ключевые принципы:

1. **Explicit over Implicit**: Каждая операция явная и отслеживаемая
2. **Zero core dependencies**: Нет внешних зависимостей в ядре
3. **Plugin architecture**: Расширяемость без bloat
4. **Production-first**: Health checks, shutdown, retry — из коробки

### 3.2 Архитектура

```
┌────────────────────────────────────────────┐
│  Optional Plugins                          │
│  @kysera/soft-delete (~4KB)               │
│  @kysera/audit (~8KB)                     │
│  @kysera/timestamps (~4KB)                │
├────────────────────────────────────────────┤
│  Repository Layer (Optional)               │
│  @kysera/repository (~12KB)               │
│  Pattern helpers, CRUD utilities           │
├────────────────────────────────────────────┤
│  Core Utilities (Minimal)                  │
│  @kysera/core (~24KB)                     │
│  Debug, health, pagination, errors         │
├────────────────────────────────────────────┤
│  Kysely (Foundation)                       │
│  Query builder, types, connections         │
└────────────────────────────────────────────┘
```

### 3.3 Техническое обоснование выбора Kysely как фундамента

**Почему Kysely, а не Drizzle?**

1. **Zero runtime overhead** — Kysely не добавляет runtime-кода к выводу типов
2. **Проверенная стабильность** — используется в production Deno, Maersk, Cal.com
3. **Отсутствие type safety issues** — в отличие от Drizzle, где только результаты типизированы
4. **Активная поддержка** — стабильные релизы без backlog-проблем Drizzle

**Почему не форк Prisma/TypeORM/MikroORM?**

1. **Размер и зависимости** — противоречат принципу minimal core
2. **Архитектурные ограничения** — сложно адаптировать для модульной архитектуры
3. **Проприетарные абстракции** — PSL у Prisma, декораторы у TypeORM

---

## Часть 4: Технический анализ реализации Kysera

### 4.1 Пакеты и их размеры

| Пакет | Размер (dist) | Тесты | Zero-deps |
|-------|---------------|-------|-----------|
| @kysera/core | ~24KB | 363 | ✓ |
| @kysera/repository | ~12KB | 127 | ✓* |
| @kysera/soft-delete | ~4KB | 39+ | ✓* |
| @kysera/audit | ~8KB | 40+ | ✓* |
| @kysera/timestamps | ~4KB | 16+ | ✓* |
| @kysera/migrations | ~12KB | 64 | ✓* |
| **Итого** | **~64KB** | **554+** | |

*Зависит только от @kysera/core

### 4.2 TypeScript-конфигурация

Kysera использует **максимально строгую** конфигурацию TypeScript:

```json
{
  "strict": true,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "noImplicitAny": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noPropertyAccessFromIndexSignature": true
}
```

Это обеспечивает уровень type safety, недостижимый в TypeORM и превосходящий Drizzle.

### 4.3 Унифицированная обработка ошибок

Kysera предоставляет multi-database error parsing:

```typescript
// PostgreSQL: 23505, MySQL: ER_DUP_ENTRY, SQLite: UNIQUE constraint failed
const error = parseDatabaseError(rawError);
if (error instanceof UniqueConstraintError) {
  // Обработка дубликата
}
```

**70 унифицированных кодов ошибок** покрывают все основные сценарии PostgreSQL, MySQL и SQLite.

### 4.4 Plugin System

В отличие от monolithic ORM, Kysera использует Method Override Pattern:

```typescript
// Soft delete плагин расширяет репозиторий
const userRepo = orm.createRepository(createUserRepository);

await userRepo.softDelete(id);        // UPDATE ... SET deleted_at = NOW()
await userRepo.restore(id);           // UPDATE ... SET deleted_at = NULL
await userRepo.hardDelete(id);        // DELETE FROM ...
await userRepo.findWithDeleted();     // Без фильтрации deleted_at
```

**Преимущество**: Каждый плагин — независимый пакет, tree-shakeable, не увеличивает размер если не используется.

### 4.5 Executor Pattern для транзакций

```typescript
// Один тип для обычного контекста и транзакции
type Executor<DB> = Kysely<DB> | Transaction<DB>;

// Репозитории работают идентично в обоих контекстах
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx);  // Одна строка!
  await repos.users.create({ email: 'test@example.com' });
  await repos.posts.create({ userId: 1, title: 'Hello' });
});
```

### 4.6 Smart Validation Strategy

```typescript
// Input ВСЕГДА валидируется (Zod)
const validated = CreateUserSchema.parse(input);

// Output валидируется только в development
const user = VALIDATE_DB_RESULTS
  ? UserSchema.parse(dbResult)
  : dbResult;
```

**Обоснование**: Input приходит извне и потенциально небезопасен. Output приходит из БД, которая сама обеспечивает constraints.

---

## Часть 5: Сравнительный анализ

### 5.1 Размер бандла

| Решение | Размер | Комментарий |
|---------|--------|-------------|
| Drizzle | 7.4KB | Только ORM, без утилит |
| **Kysera (core)** | **24KB** | **+ health, debug, retry, pagination** |
| **Kysera (full)** | **64KB** | **+ repository, plugins** |
| Prisma (new) | 1.6MB | После перехода на TypeScript |
| Prisma (old) | 14MB | С Rust binary |

### 5.2 Type Safety

| Решение | Input Types | Output Types | Query Types | Runtime Validation |
|---------|-------------|--------------|-------------|-------------------|
| Kysely | ✓ | ✓ | ✓ | ✗ |
| Drizzle | ✓ | ✓ | ✗ | ✗ |
| Prisma | ✓ | ✓ | ✓ | ✗ |
| **Kysera** | **✓** | **✓** | **✓** | **✓ (Zod)** |
| TypeORM | ~✓ | ~✓ | ✗ | ✗ |

### 5.3 Production Features

| Feature | Kysely | Drizzle | Prisma | Kysera |
|---------|--------|---------|--------|--------|
| Health Checks | ✗ | ✗ | ✗ | ✓ |
| Graceful Shutdown | ✗ | ✗ | ✗ | ✓ |
| Retry Logic | ✗ | ✗ | ✗ | ✓ |
| Circuit Breaker | ✗ | ✗ | ✗ | ✓ |
| Query Profiling | ✗ | ✗ | Limited | ✓ |
| Pool Metrics | ✗ | ✗ | ✗ | ✓ |

### 5.4 Multi-Database Support

| Feature | Kysera | Drizzle | Prisma | TypeORM |
|---------|--------|---------|--------|---------|
| PostgreSQL | ✓ | ✓ | ✓ | ✓ |
| MySQL | ✓ | ✓ | ✓ | ✓ |
| SQLite | ✓ | ✓ | ✓ | ✓ |
| Unified Error Codes | ✓ | ✗ | ✗ | ✗ |

### 5.5 Runtime Support

| Runtime | Kysera | Drizzle | Prisma* | Kysely |
|---------|--------|---------|---------|--------|
| Node.js 20+ | ✓ | ✓ | ✓ | ✓ |
| Bun | ✓ | ✓ | ✓ | ✓ |
| Deno | ✓ | ✓ | ✓ | ✓ |
| Cloudflare Workers | ✓ | ✓ | ✓ | ✓ |

*Prisma требует Rust-free версию для полной поддержки

---

## Часть 6: Когда использовать Kysera

### 6.1 Идеальные сценарии

1. **Microservices с требованием к размеру бандла**
   - Serverless, edge computing, Cloudflare Workers
   - Когда 14MB Prisma — неприемлемо, а 7KB Drizzle — недостаточно

2. **Проекты с multi-database требованиями**
   - Унифицированная обработка ошибок PostgreSQL/MySQL/SQLite
   - Единый API для всех баз данных

3. **Production-критичные системы**
   - Health checks и monitoring
   - Graceful shutdown
   - Circuit breaker и retry logic

4. **Команды, знающие SQL**
   - Полный контроль над запросами через Kysely
   - Без «магии» и скрытого поведения

5. **Постепенная миграция с Kysely**
   - Kysera — надстройка, не замена
   - Можно использовать только нужные пакеты

### 6.2 Когда НЕ использовать Kysera

1. **Быстрое прототипирование без SQL-знаний** → Prisma
2. **Complex domain model с Unit of Work** → MikroORM
3. **Только query building без ORM-функций** → Raw Kysely
4. **Минимальный размер без features** → Drizzle

---

## Заключение

Создание Kysera — не попытка «изобрести велосипед», а ответ на конкретную инженерную проблему: отсутствие в экосистеме TypeScript ORM решения, которое бы:

1. **Строилось на проверенном фундаменте** (Kysely) с zero runtime overhead
2. **Предоставляло production-ready утилиты** (health, shutdown, retry) из коробки
3. **Имело модульную архитектуру** — используй только то, что нужно
4. **Обеспечивало максимальную type safety** без компромиссов
5. **Не имело внешних зависимостей** в ядре
6. **Поддерживало multi-database** с унифицированной обработкой ошибок

Kysera занимает нишу между минималистичными query builders и тяжёлыми ORM, предоставляя «golden path» для production TypeScript-приложений.

---

## Ссылки и источники

### Исследования конкурентов
- [Prisma: From Rust to TypeScript](https://www.prisma.io/blog/from-rust-to-typescript-a-new-chapter-for-prisma-orm)
- [Drizzle vs Prisma Benchmarks](https://www.prisma.io/blog/performance-benchmarks-comparing-query-latency-across-typescript-orms-and-databases)
- [Drizzle GitHub Issue #4391: Is the project healthy?](https://github.com/drizzle-team/drizzle-orm/issues/4391)
- [TypeORM Issues Repository](https://github.com/typeorm/typeorm/issues)
- [Kysely Documentation](https://kysely.dev/)

### Технические данные
- npm download statistics (npmjs.com)
- GitHub repositories и issue trackers
- Best of JS (bestofjs.org)

### Версии на момент анализа
- Prisma: 7.1.0
- Drizzle: 0.45.0
- Kysely: 0.28.7
- TypeORM: Latest stable
- MikroORM: 6.6.1
- Knex.js: Latest stable

---

*Статья подготовлена на основе анализа исходного кода, документации и публичных данных. Все утверждения подкреплены ссылками на источники или результатами исследования кодовой базы.*

*Дата: Декабрь 2025*
*Версия Kysera: 0.5.1*
