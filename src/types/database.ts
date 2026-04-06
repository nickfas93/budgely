/**
 * Tipos do banco de dados Supabase — Budgely
 *
 * Reflete o schema em supabase/schema.sql.
 * Usado para type-safety nas queries Supabase em toda a aplicação.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      budgely_users: {
        Row: {
          id: string
          name: string
          monthly_salary: number
          whatsapp_phone: string | null
          created_at: string
        }
        Insert: {
          id: string
          name: string
          monthly_salary?: number
          whatsapp_phone?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['budgely_users']['Insert']>
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          slug: string
          label: string
          color: string
          icon: string | null
        }
        Insert: {
          id?: string
          slug: string
          label: string
          color: string
          icon?: string | null
        }
        Update: Partial<Database['public']['Tables']['categories']['Insert']>
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          date: string
          amount: number
          description: string
          merchant: string | null
          category_id: string | null
          raw_category: string | null
          source: string
          bank: string | null
          card_last4: string | null
          alelo_wallet_type: string | null
          import_id: string | null
          is_installment: boolean
          installment_current: number | null
          installment_total: number | null
          notes: string | null
          fingerprint: string | null
          status: string
          deleted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          amount: number
          description: string
          merchant?: string | null
          category_id?: string | null
          raw_category?: string | null
          source: string
          bank?: string | null
          card_last4?: string | null
          alelo_wallet_type?: string | null
          import_id?: string | null
          is_installment?: boolean
          installment_current?: number | null
          installment_total?: number | null
          notes?: string | null
          fingerprint?: string | null
          status?: string
          deleted_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['transactions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'transactions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      pdf_imports: {
        Row: {
          id: string
          user_id: string
          bank: string
          filename: string
          status: string
          total_transactions: number | null
          imported_count: number
          error_message: string | null
          reference_month: string | null
          file_hash: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          bank: string
          filename: string
          status?: string
          total_transactions?: number | null
          imported_count?: number
          error_message?: string | null
          reference_month?: string | null
          file_hash?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['pdf_imports']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'pdf_imports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
        ]
      }
      fixed_costs: {
        Row: {
          id: string
          user_id: string
          name: string
          amount: number
          category_id: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          amount: number
          category_id?: string | null
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fixed_costs']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'fixed_costs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixed_costs_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      alelo_budgets: {
        Row: {
          id: string
          user_id: string
          month: string
          refeicao_budget: number
          alimentacao_budget: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          month: string
          refeicao_budget?: number
          alimentacao_budget?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['alelo_budgets']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'alelo_budgets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
        ]
      }
      llm_analyses: {
        Row: {
          id: string
          month: string
          type: string
          content: string
          total_spent: number | null
          total_budget: number | null
          created_at: string
        }
        Insert: {
          id?: string
          month: string
          type: string
          content: string
          total_spent?: number | null
          total_budget?: number | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['llm_analyses']['Insert']>
        Relationships: []
      }
      wa_sessions: {
        Row: {
          id: string
          user_id: string | null
          phone: string
          state: string
          temp_data: Json | null
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          phone: string
          state?: string
          temp_data?: Json | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['wa_sessions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'wa_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
        ]
      }
      processed_webhook_messages: {
        Row: {
          id: string
          message_id: string
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['processed_webhook_messages']['Insert']>
        Relationships: []
      }
      budgets: {
        Row: {
          id: string
          user_id: string
          category_id: string
          month: string
          amount: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category_id: string
          month: string
          amount: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['budgets']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'budgets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'budgets_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      savings_goals: {
        Row: {
          id: string
          user_id: string
          name: string
          target_amount: number
          current_amount: number
          deadline: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          target_amount: number
          current_amount?: number
          deadline?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['savings_goals']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'savings_goals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
        ]
      }
      investment_assets: {
        Row: {
          id: string
          user_id: string
          ticker: string
          name: string | null
          quantity: number
          avg_price: number
          asset_type: 'acao' | 'fii' | 'etf' | 'bdr' | 'crypto'
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          ticker: string
          name?: string | null
          quantity: number
          avg_price: number
          asset_type: 'acao' | 'fii' | 'etf' | 'bdr' | 'crypto'
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['investment_assets']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'investment_assets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'budgely_users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
  }
}

export type BudgelyUser = Database['public']['Tables']['budgely_users']['Row']
export type Category = Database['public']['Tables']['categories']['Row']
export type Transaction = Database['public']['Tables']['transactions']['Row']
export type PdfImport = Database['public']['Tables']['pdf_imports']['Row']
export type FixedCost = Database['public']['Tables']['fixed_costs']['Row']
export type AleloBudget = Database['public']['Tables']['alelo_budgets']['Row']
export type LlmAnalysis = Database['public']['Tables']['llm_analyses']['Row']
export type WaSession = Database['public']['Tables']['wa_sessions']['Row']
export type ProcessedWebhookMessage = Database['public']['Tables']['processed_webhook_messages']['Row']
export type Budget = Database['public']['Tables']['budgets']['Row']
export type SavingsGoal = Database['public']['Tables']['savings_goals']['Row']
export type InvestmentAsset = Database['public']['Tables']['investment_assets']['Row']
