export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: string | null
          id: number
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          id?: never
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          id?: never
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          deleted_at: string | null
          id: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          deleted_at?: string | null
          id?: never
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          deleted_at?: string | null
          id?: never
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          category_name: string | null
          id: number
          invoice_id: number | null
          item_name: string
          price: number
          qty: number
        }
        Insert: {
          category_name?: string | null
          id?: never
          invoice_id?: number | null
          item_name: string
          price: number
          qty: number
        }
        Update: {
          category_name?: string | null
          id?: never
          invoice_id?: number | null
          item_name?: string
          price?: number
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          customer_name: string
          discount: number
          id: number
          invoice_no: number
          seller_id: string | null
          subtotal: number
          tax: number
          total: number
        }
        Insert: {
          created_at?: string
          customer_name?: string
          discount?: number
          id?: never
          invoice_no: number
          seller_id?: string | null
          subtotal?: number
          tax?: number
          total?: number
        }
        Update: {
          created_at?: string
          customer_name?: string
          discount?: number
          id?: never
          invoice_no?: number
          seller_id?: string | null
          subtotal?: number
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          barcode: string | null
          category_id: number | null
          deleted_at: string | null
          display_qs: number
          id: number
          image_url: string | null
          min_alert: number
          name: string
          price_num: number
          price_text: string
          stock_q: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: number | null
          deleted_at?: string | null
          display_qs?: number
          id?: never
          image_url?: string | null
          min_alert?: number
          name: string
          price_num?: number
          price_text?: string
          stock_q?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: number | null
          deleted_at?: string | null
          display_qs?: number
          id?: never
          image_url?: string | null
          min_alert?: number
          name?: string
          price_num?: number
          price_text?: string
          stock_q?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          role?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string
          username?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      my_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]
export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
