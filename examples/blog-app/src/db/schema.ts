import type { Generated } from 'kysely'

/**
 * Database schema for blog application
 */

export interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<Date>
  deleted_at: Date | null
}

export interface PostsTable {
  id: Generated<number>
  user_id: number
  title: string
  content: string
  published: boolean
  created_at: Generated<Date>
  updated_at: Date | null
  deleted_at: Date | null
}

export interface CommentsTable {
  id: Generated<number>
  post_id: number
  user_id: number
  content: string
  created_at: Generated<Date>
  deleted_at: Date | null
}

export interface MigrationsTable {
  name: string
  executed_at: Generated<Date>
}

export interface Database {
  users: UsersTable
  posts: PostsTable
  comments: CommentsTable
  migrations: MigrationsTable
}