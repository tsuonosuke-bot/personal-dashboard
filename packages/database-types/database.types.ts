export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      budget_categories: {
        Row: {
          id: number
          name: string
          notion_url: string | null
        }
        Insert: {
          id: number
          name: string
          notion_url?: string | null
        }
        Update: {
          id?: number
          name?: string
          notion_url?: string | null
        }
        Relationships: []
      }
      daily_journal: {
        Row: {
          categories: string[]
          embedded_at: string | null
          embedding: string | null
          embedding_input: string | null
          emotion_summary: string | null
          emotions: string[]
          entities: string[]
          entry_date: string
          model_version: string | null
          mood: number | null
          processed_at: string
          source_last_edited_at: string | null
          source_pages: Json
          summary: string
          themes: string[]
        }
        Insert: {
          categories?: string[]
          embedded_at?: string | null
          embedding?: string | null
          embedding_input?: string | null
          emotion_summary?: string | null
          emotions?: string[]
          entities?: string[]
          entry_date: string
          model_version?: string | null
          mood?: number | null
          processed_at?: string
          source_last_edited_at?: string | null
          source_pages?: Json
          summary: string
          themes?: string[]
        }
        Update: {
          categories?: string[]
          embedded_at?: string | null
          embedding?: string | null
          embedding_input?: string | null
          emotion_summary?: string | null
          emotions?: string[]
          entities?: string[]
          entry_date?: string
          model_version?: string | null
          mood?: number | null
          processed_at?: string
          source_last_edited_at?: string | null
          source_pages?: Json
          summary?: string
          themes?: string[]
        }
        Relationships: []
      }
      dashboard_handoff_nonce: {
        Row: {
          consumed_at: string
          expires_at: string
          nonce: string
        }
        Insert: {
          consumed_at?: string
          expires_at: string
          nonce: string
        }
        Update: {
          consumed_at?: string
          expires_at?: string
          nonce?: string
        }
        Relationships: []
      }
      dashboard_schema_versions: {
        Row: {
          app_id: string
          migration: string
          updated_at: string
        }
        Insert: {
          app_id: string
          migration: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          migration?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: number
          memo: string | null
          notion_created_at: string | null
          notion_url: string | null
          payer: string | null
          title: string | null
          transaction_date: string
          voided_at: string | null
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          id?: number
          memo?: string | null
          notion_created_at?: string | null
          notion_url?: string | null
          payer?: string | null
          title?: string | null
          transaction_date: string
          voided_at?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: number
          memo?: string | null
          notion_created_at?: string | null
          notion_url?: string | null
          payer?: string | null
          title?: string | null
          transaction_date?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["name"]
          },
        ]
      }
      focus_items: {
        Row: {
          content: string
          created_at: string
          id: number
          note: string | null
          sort_order: number | null
          source_route_id: number
          source_want_id: number
          status: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: number
          note?: string | null
          sort_order?: number | null
          source_route_id: number
          source_want_id: number
          status?: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: number
          note?: string | null
          sort_order?: number | null
          source_route_id?: number
          source_want_id?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_items_source_route_id_fkey"
            columns: ["source_route_id"]
            isOneToOne: true
            referencedRelation: "want_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_items_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "due_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_items_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_items_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants_view"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          created_at: string
          habit_id: number
          id: number
          kind: string
          note: string | null
          practiced_on: string
          tracking_key: string | null
        }
        Insert: {
          created_at?: string
          habit_id: number
          id?: number
          kind?: string
          note?: string | null
          practiced_on: string
          tracking_key?: string | null
        }
        Update: {
          created_at?: string
          habit_id?: number
          id?: number
          kind?: string
          note?: string | null
          practiced_on?: string
          tracking_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          cadence: string
          calendar_event_id: string | null
          calendar_url: string | null
          created_at: string
          id: number
          name: string
          purpose: string | null
          source_route_id: number | null
          source_want_id: number | null
          started_on: string
          status: string
          target_per_week: number
          updated_at: string
        }
        Insert: {
          cadence: string
          calendar_event_id?: string | null
          calendar_url?: string | null
          created_at?: string
          id?: number
          name: string
          purpose?: string | null
          source_route_id?: number | null
          source_want_id?: number | null
          started_on?: string
          status?: string
          target_per_week?: number
          updated_at?: string
        }
        Update: {
          cadence?: string
          calendar_event_id?: string | null
          calendar_url?: string | null
          created_at?: string
          id?: number
          name?: string
          purpose?: string | null
          source_route_id?: number | null
          source_want_id?: number | null
          started_on?: string
          status?: string
          target_per_week?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_source_route_id_fkey"
            columns: ["source_route_id"]
            isOneToOne: true
            referencedRelation: "want_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "due_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habits_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants_view"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_inbox: {
        Row: {
          content: string
          created_at: string
          id: number
          result: string | null
          source: string | null
          status: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          result?: string | null
          source?: string | null
          status?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          result?: string | null
          source?: string | null
          status?: string
        }
        Relationships: []
      }
      inbox_sf6_routes: {
        Row: {
          created_at: string
          drill_id: number | null
          idempotency_key: string
          inbox_id: number | null
          request: Json
          resource: string
          sequence_id: number | null
          situation_id: number | null
          source_content: string
          source_inbox_id_snapshot: number
          source_result: string | null
          target_id_snapshot: number
        }
        Insert: {
          created_at?: string
          drill_id?: number | null
          idempotency_key: string
          inbox_id?: number | null
          request: Json
          resource: string
          sequence_id?: number | null
          situation_id?: number | null
          source_content: string
          source_inbox_id_snapshot: number
          source_result?: string | null
          target_id_snapshot: number
        }
        Update: {
          created_at?: string
          drill_id?: number | null
          idempotency_key?: string
          inbox_id?: number | null
          request?: Json
          resource?: string
          sequence_id?: number | null
          situation_id?: number | null
          source_content?: string
          source_inbox_id_snapshot?: number
          source_result?: string | null
          target_id_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "inbox_sf6_routes_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "sf6_drills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_sf6_routes_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: true
            referencedRelation: "idea_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_sf6_routes_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: true
            referencedRelation: "idea_inbox_pending_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_sf6_routes_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sf6_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_sf6_routes_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "sf6_situations"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_analysis_cache: {
        Row: {
          analysis: Json
          analyzed_at: string
          input_hash: string
        }
        Insert: {
          analysis: Json
          analyzed_at?: string
          input_hash: string
        }
        Update: {
          analysis?: Json
          analyzed_at?: string
          input_hash?: string
        }
        Relationships: []
      }
      insight_group_members: {
        Row: {
          group_id: number
          insight_id: number
        }
        Insert: {
          group_id: number
          insight_id: number
        }
        Update: {
          group_id?: number
          insight_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "insight_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "insight_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_group_members_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "knowledge_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_groups: {
        Row: {
          created_at: string
          guiding_question: string
          id: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guiding_question: string
          id?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guiding_question?: string
          id?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          connected_at: string
          encrypted_credentials: string
          provider: string
          scope: string
          updated_at: string
        }
        Insert: {
          connected_at?: string
          encrypted_credentials: string
          provider: string
          scope: string
          updated_at?: string
        }
        Update: {
          connected_at?: string
          encrypted_credentials?: string
          provider?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge: {
        Row: {
          accuracy: number | null
          archived: boolean
          base_interval_days: number
          category: string
          claim_evidence: string | null
          content_version: number
          created_at: string
          ef: number
          explanation: string | null
          id: string
          interval_days: number
          knowledge_kind: string
          last_asked_on: string | null
          last_reviewed_at: string | null
          learned_on: string
          mastery: string
          mastery_streak: number
          next_review_at: string
          next_review_on: string | null
          notion_id: string | null
          priority: string
          relearning_penalized: boolean
          relearning_quality: number | null
          relearning_stage: string | null
          reps: number
          scheduled_from_at: string | null
          source_note: string | null
          stability_hours: number
          tags: string[]
          times_asked: number
          times_correct: number
          title: string
        }
        Insert: {
          accuracy?: number | null
          archived?: boolean
          base_interval_days?: number
          category: string
          claim_evidence?: string | null
          content_version?: number
          created_at?: string
          ef?: number
          explanation?: string | null
          id?: string
          interval_days?: number
          knowledge_kind?: string
          last_asked_on?: string | null
          last_reviewed_at?: string | null
          learned_on?: string
          mastery?: string
          mastery_streak?: number
          next_review_at?: string
          next_review_on?: string | null
          notion_id?: string | null
          priority?: string
          relearning_penalized?: boolean
          relearning_quality?: number | null
          relearning_stage?: string | null
          reps?: number
          scheduled_from_at?: string | null
          source_note?: string | null
          stability_hours?: number
          tags?: string[]
          times_asked?: number
          times_correct?: number
          title: string
        }
        Update: {
          accuracy?: number | null
          archived?: boolean
          base_interval_days?: number
          category?: string
          claim_evidence?: string | null
          content_version?: number
          created_at?: string
          ef?: number
          explanation?: string | null
          id?: string
          interval_days?: number
          knowledge_kind?: string
          last_asked_on?: string | null
          last_reviewed_at?: string | null
          learned_on?: string
          mastery?: string
          mastery_streak?: number
          next_review_at?: string
          next_review_on?: string | null
          notion_id?: string | null
          priority?: string
          relearning_penalized?: boolean
          relearning_quality?: number | null
          relearning_stage?: string | null
          reps?: number
          scheduled_from_at?: string | null
          source_note?: string | null
          stability_hours?: number
          tags?: string[]
          times_asked?: number
          times_correct?: number
          title?: string
        }
        Relationships: []
      }
      knowledge_auto_tag_state: {
        Row: {
          evaluated_at: string
          input_hash: string
          knowledge_id: string
          model: string
        }
        Insert: {
          evaluated_at?: string
          input_hash: string
          knowledge_id: string
          model: string
        }
        Update: {
          evaluated_at?: string
          input_hash?: string
          knowledge_id?: string
          model?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_auto_tag_state_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: true
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_auto_tags: {
        Row: {
          assigned_at: string
          knowledge_id: string
          removed_at: string | null
          similarity: number
          tag: string
        }
        Insert: {
          assigned_at?: string
          knowledge_id: string
          removed_at?: string | null
          similarity: number
          tag: string
        }
        Update: {
          assigned_at?: string
          knowledge_id?: string
          removed_at?: string | null
          similarity?: number
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_auto_tags_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_auto_tags_tag_fkey"
            columns: ["tag"]
            isOneToOne: false
            referencedRelation: "knowledge_tag_vocabulary"
            referencedColumns: ["tag"]
          },
        ]
      }
      knowledge_insights: {
        Row: {
          body: string
          created_at: string
          id: number
          knowledge_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: number
          knowledge_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: number
          knowledge_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_insights_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_mastery_history: {
        Row: {
          changed_at: string
          from_mastery: string | null
          id: number
          is_baseline: boolean
          knowledge_id: string
          to_mastery: string
        }
        Insert: {
          changed_at?: string
          from_mastery?: string | null
          id?: number
          is_baseline?: boolean
          knowledge_id: string
          to_mastery: string
        }
        Update: {
          changed_at?: string
          from_mastery?: string | null
          id?: number
          is_baseline?: boolean
          knowledge_id?: string
          to_mastery?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_mastery_history_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_tag_vocabulary: {
        Row: {
          centroid: string
          created_at: string
          model: string
          seed_count: number
          tag: string
          updated_at: string
        }
        Insert: {
          centroid: string
          created_at?: string
          model: string
          seed_count: number
          tag: string
          updated_at?: string
        }
        Update: {
          centroid?: string
          created_at?: string
          model?: string
          seed_count?: number
          tag?: string
          updated_at?: string
        }
        Relationships: []
      }
      personal_profile: {
        Row: {
          ai_visible: boolean
          category: string
          created_at: string
          detail: string | null
          id: number
          name: string
          since: string | null
          until: string | null
          updated_at: string
          value: string
        }
        Insert: {
          ai_visible?: boolean
          category: string
          created_at?: string
          detail?: string | null
          id?: never
          name: string
          since?: string | null
          until?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          ai_visible?: boolean
          category?: string
          created_at?: string
          detail?: string | null
          id?: never
          name?: string
          since?: string | null
          until?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      project_action_todos: {
        Row: {
          created_at: string
          project_action_id: number
          scheduled_action_id: number
        }
        Insert: {
          created_at?: string
          project_action_id: number
          scheduled_action_id: number
        }
        Update: {
          created_at?: string
          project_action_id?: number
          scheduled_action_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_action_todos_project_action_id_fkey"
            columns: ["project_action_id"]
            isOneToOne: true
            referencedRelation: "project_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_action_todos_scheduled_action_id_fkey"
            columns: ["scheduled_action_id"]
            isOneToOne: true
            referencedRelation: "scheduled_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      project_actions: {
        Row: {
          completed_at: string | null
          content: string
          created_at: string
          due_on: string | null
          id: number
          milestone_id: number | null
          project_id: number
          project_item_id: number | null
          sort_order: number | null
          start_on: string | null
          status: string
          updated_at: string
          waiting_for: string | null
        }
        Insert: {
          completed_at?: string | null
          content: string
          created_at?: string
          due_on?: string | null
          id?: number
          milestone_id?: number | null
          project_id: number
          project_item_id?: number | null
          sort_order?: number | null
          start_on?: string | null
          status?: string
          updated_at?: string
          waiting_for?: string | null
        }
        Update: {
          completed_at?: string | null
          content?: string
          created_at?: string
          due_on?: string | null
          id?: number
          milestone_id?: number | null
          project_id?: number
          project_item_id?: number | null
          sort_order?: number | null
          start_on?: string | null
          status?: string
          updated_at?: string
          waiting_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_actions_milestone_same_project_fkey"
            columns: ["project_id", "milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "project_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_actions_project_item_id_fkey"
            columns: ["project_item_id"]
            isOneToOne: false
            referencedRelation: "project_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_items: {
        Row: {
          created_at: string
          id: number
          project_id: number
          source_content: string
          source_id: number
          source_type: string
          treatment: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          project_id: number
          source_content: string
          source_id: number
          source_type: string
          treatment?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          project_id?: number
          source_content?: string
          source_id?: number
          source_type?: string
          treatment?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          created_at: string
          due_on: string | null
          id: number
          project_id: number
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_on?: string | null
          id?: number
          project_id: number
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_on?: string | null
          id?: number
          project_id?: number
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_todo_read_cache: {
        Row: {
          effective_date: string
          fetched_at: string
          schedule: Json | null
          scheduled_action_id: number
          todo_updated_at: string
        }
        Insert: {
          effective_date: string
          fetched_at: string
          schedule?: Json | null
          scheduled_action_id: number
          todo_updated_at: string
        }
        Update: {
          effective_date?: string
          fetched_at?: string
          schedule?: Json | null
          scheduled_action_id?: number
          todo_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_todo_read_cache_scheduled_action_id_fkey"
            columns: ["scheduled_action_id"]
            isOneToOne: true
            referencedRelation: "scheduled_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          completed_at: string | null
          created_at: string
          id: number
          outcome: string
          review_on: string | null
          status: string
          target_on: string | null
          theme: string | null
          title: string
          updated_at: string
          waiting_for: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: number
          outcome: string
          review_on?: string | null
          status?: string
          target_on?: string | null
          theme?: string | null
          title: string
          updated_at?: string
          waiting_for?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: number
          outcome?: string
          review_on?: string | null
          status?: string
          target_on?: string | null
          theme?: string | null
          title?: string
          updated_at?: string
          waiting_for?: string | null
        }
        Relationships: []
      }
      question_embeddings: {
        Row: {
          embedded_at: string
          embedding: string
          group_id: number
          input_hash: string
          model: string
        }
        Insert: {
          embedded_at?: string
          embedding: string
          group_id: number
          input_hash: string
          model: string
        }
        Update: {
          embedded_at?: string
          embedding?: string
          group_id?: number
          input_hash?: string
          model?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_embeddings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "insight_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      question_material_exclusions: {
        Row: {
          excluded_at: string
          group_id: number
          source_id: string
          source_type: string
        }
        Insert: {
          excluded_at?: string
          group_id: number
          source_id: string
          source_type: string
        }
        Update: {
          excluded_at?: string
          group_id?: number
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_material_exclusions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "insight_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_log: {
        Row: {
          answered_at: string | null
          asked_on: string
          attempt_id: string | null
          confirmed_at: string | null
          correct_answer: string | null
          created_at: string
          explanation: string | null
          format: string
          id: number
          knowledge_id: string
          note: string | null
          quality: number
          question: string | null
          review_queue_id: number | null
          schedule_updated: boolean
          sync_event_id: string | null
          user_answer: string | null
          verdict: string
          was_early: boolean
        }
        Insert: {
          answered_at?: string | null
          asked_on?: string
          attempt_id?: string | null
          confirmed_at?: string | null
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          format?: string
          id?: never
          knowledge_id: string
          note?: string | null
          quality: number
          question?: string | null
          review_queue_id?: number | null
          schedule_updated?: boolean
          sync_event_id?: string | null
          user_answer?: string | null
          verdict: string
          was_early?: boolean
        }
        Update: {
          answered_at?: string | null
          asked_on?: string
          attempt_id?: string | null
          confirmed_at?: string | null
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          format?: string
          id?: never
          knowledge_id?: string
          note?: string | null
          quality?: number
          question?: string | null
          review_queue_id?: number | null
          schedule_updated?: boolean
          sync_event_id?: string | null
          user_answer?: string | null
          verdict?: string
          was_early?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "quiz_log_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_log_review_queue_fk"
            columns: ["review_queue_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expense_occurrences: {
        Row: {
          created_at: string
          expense_id: number
          rule_id: number
          scheduled_for: string
        }
        Insert: {
          created_at?: string
          expense_id: number
          rule_id: number
          scheduled_for: string
        }
        Update: {
          created_at?: string
          expense_id?: number
          rule_id?: number
          scheduled_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expense_occurrences_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expense_occurrences_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string
          day_of_month: number
          end_date: string | null
          frequency: string
          id: number
          interval_count: number
          last_generated_at: string | null
          memo: string | null
          next_run_date: string
          payer: string | null
          source_expense_id: number | null
          start_date: string
          template_rule_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount: number
          category: string
          created_at?: string
          day_of_month: number
          end_date?: string | null
          frequency: string
          id?: number
          interval_count?: number
          last_generated_at?: string | null
          memo?: string | null
          next_run_date: string
          payer?: string | null
          source_expense_id?: number | null
          start_date: string
          template_rule_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string
          day_of_month?: number
          end_date?: string | null
          frequency?: string
          id?: number
          interval_count?: number
          last_generated_at?: string | null
          memo?: string | null
          next_run_date?: string
          payer?: string | null
          source_expense_id?: number | null
          start_date?: string
          template_rule_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "recurring_expenses_source_expense_id_fkey"
            columns: ["source_expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_template_rule_id_fkey"
            columns: ["template_rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      review_ai_batches: {
        Row: {
          created_at: string
          finished_at: string | null
          id: number
          item_ids: number[]
          kind: string
          knowledge_ids: string[]
          note: string | null
          payload: Json
          provider_batch_id: string
          status: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: number
          item_ids?: number[]
          kind: string
          knowledge_ids?: string[]
          note?: string | null
          payload: Json
          provider_batch_id: string
          status?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: number
          item_ids?: number[]
          kind?: string
          knowledge_ids?: string[]
          note?: string | null
          payload?: Json
          provider_batch_id?: string
          status?: string
        }
        Relationships: []
      }
      review_batch_runs: {
        Row: {
          failed: number
          finished_at: string | null
          id: number
          kind: string
          note: string | null
          processed: number
          started_at: string
          status: string
          succeeded: number
          trigger: string
        }
        Insert: {
          failed?: number
          finished_at?: string | null
          id?: number
          kind: string
          note?: string | null
          processed?: number
          started_at?: string
          status?: string
          succeeded?: number
          trigger: string
        }
        Update: {
          failed?: number
          finished_at?: string | null
          id?: number
          kind?: string
          note?: string | null
          processed?: number
          started_at?: string
          status?: string
          succeeded?: number
          trigger?: string
        }
        Relationships: []
      }
      review_generation_holds: {
        Row: {
          content_version: number
          failure_count: number
          knowledge_id: string
          last_failed_at: string
          last_question: string | null
          last_reason: string
          retry_after: string
        }
        Insert: {
          content_version: number
          failure_count?: number
          knowledge_id: string
          last_failed_at?: string
          last_question?: string | null
          last_reason: string
          retry_after: string
        }
        Update: {
          content_version?: number
          failure_count?: number
          knowledge_id?: string
          last_failed_at?: string
          last_question?: string | null
          last_reason?: string
          retry_after?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_generation_holds_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: true
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      review_generation_jobs: {
        Row: {
          generation_run_id: number | null
          item_id: number
          next_attempt_at: string
          status: string
          updated_at: string
        }
        Insert: {
          generation_run_id?: number | null
          item_id: number
          next_attempt_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          generation_run_id?: number | null
          item_id?: number
          next_attempt_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_generation_jobs_generation_run_id_fkey"
            columns: ["generation_run_id"]
            isOneToOne: false
            referencedRelation: "review_batch_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_generation_jobs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "review_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue: {
        Row: {
          answer_text: string | null
          answered_at: string | null
          choices: Json | null
          content_version: number
          correct_choice: string | null
          discarded_reason: string | null
          expected_answer: string | null
          format: string
          generated_at: string
          grade_attempts: number
          graded_at: string | null
          grading_started_at: string | null
          id: number
          knowledge_id: string
          last_error: string | null
          prepared_explanation: string | null
          question: string
          status: string
        }
        Insert: {
          answer_text?: string | null
          answered_at?: string | null
          choices?: Json | null
          content_version: number
          correct_choice?: string | null
          discarded_reason?: string | null
          expected_answer?: string | null
          format: string
          generated_at?: string
          grade_attempts?: number
          graded_at?: string | null
          grading_started_at?: string | null
          id?: number
          knowledge_id: string
          last_error?: string | null
          prepared_explanation?: string | null
          question: string
          status?: string
        }
        Update: {
          answer_text?: string | null
          answered_at?: string | null
          choices?: Json | null
          content_version?: number
          correct_choice?: string | null
          discarded_reason?: string | null
          expected_answer?: string | null
          format?: string
          generated_at?: string
          grade_attempts?: number
          graded_at?: string | null
          grading_started_at?: string | null
          id?: number
          knowledge_id?: string
          last_error?: string | null
          prepared_explanation?: string | null
          question?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_action_schedule_history: {
        Row: {
          changed_at: string
          id: number
          next_schedule: Json
          previous_schedule: Json
          scheduled_action_id: number
        }
        Insert: {
          changed_at?: string
          id?: number
          next_schedule: Json
          previous_schedule: Json
          scheduled_action_id: number
        }
        Update: {
          changed_at?: string
          id?: number
          next_schedule?: Json
          previous_schedule?: Json
          scheduled_action_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_action_schedule_history_scheduled_action_id_fkey"
            columns: ["scheduled_action_id"]
            isOneToOne: false
            referencedRelation: "scheduled_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_actions: {
        Row: {
          calendar_etag: string | null
          calendar_state: string
          calendar_title: string | null
          calendar_url: string | null
          completed_at: string | null
          created_at: string
          current_schedule: Json
          google_event_id: string | null
          id: number
          last_calendar_sync_at: string | null
          note: string | null
          reschedule_count: number
          source_route_id: number | null
          status: string
          updated_at: string
        }
        Insert: {
          calendar_etag?: string | null
          calendar_state?: string
          calendar_title?: string | null
          calendar_url?: string | null
          completed_at?: string | null
          created_at?: string
          current_schedule: Json
          google_event_id?: string | null
          id?: number
          last_calendar_sync_at?: string | null
          note?: string | null
          reschedule_count?: number
          source_route_id?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          calendar_etag?: string | null
          calendar_state?: string
          calendar_title?: string | null
          calendar_url?: string | null
          completed_at?: string | null
          created_at?: string
          current_schedule?: Json
          google_event_id?: string | null
          id?: number
          last_calendar_sync_at?: string | null
          note?: string | null
          reschedule_count?: number
          source_route_id?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_actions_source_route_id_fkey"
            columns: ["source_route_id"]
            isOneToOne: true
            referencedRelation: "want_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_embeddings: {
        Row: {
          embedded_at: string
          embedding: string
          input_hash: string
          model: string
          source_id: string
          source_type: string
        }
        Insert: {
          embedded_at?: string
          embedding: string
          input_hash: string
          model: string
          source_id: string
          source_type: string
        }
        Update: {
          embedded_at?: string
          embedding?: string
          input_hash?: string
          model?: string
          source_id?: string
          source_type?: string
        }
        Relationships: []
      }
      sf6_backup_20261025_sequence_results: {
        Row: {
          hit_type: string | null
          id: number | null
          kind: string | null
          next_situation_id: number | null
          opponent_action: string | null
          outcome: string | null
          sequence_id: number | null
        }
        Insert: {
          hit_type?: string | null
          id?: number | null
          kind?: string | null
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id?: number | null
        }
        Update: {
          hit_type?: string | null
          id?: number | null
          kind?: string | null
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id?: number | null
        }
        Relationships: []
      }
      sf6_backup_20261025_sequence_starts: {
        Row: {
          sequence_id: number | null
          situation_id: number | null
        }
        Insert: {
          sequence_id?: number | null
          situation_id?: number | null
        }
        Update: {
          sequence_id?: number | null
          situation_id?: number | null
        }
        Relationships: []
      }
      sf6_backup_20261025_sequences: {
        Row: {
          aim: string | null
          archived: boolean | null
          character: string | null
          created_at: string | null
          damage: number | null
          drive_cost: number | null
          end_purpose: string | null
          id: number | null
          kind: string | null
          layering: string | null
          mastery: number | null
          memo: string | null
          notation: string | null
          position: string | null
          sa_cost: number | null
          startup: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          aim?: string | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          damage?: number | null
          drive_cost?: number | null
          end_purpose?: string | null
          id?: number | null
          kind?: string | null
          layering?: string | null
          mastery?: number | null
          memo?: string | null
          notation?: string | null
          position?: string | null
          sa_cost?: number | null
          startup?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          aim?: string | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          damage?: number | null
          drive_cost?: number | null
          end_purpose?: string | null
          id?: number | null
          kind?: string | null
          layering?: string | null
          mastery?: number | null
          memo?: string | null
          notation?: string | null
          position?: string | null
          sa_cost?: number | null
          startup?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sf6_backup_20261025_situations: {
        Row: {
          advantage: number | null
          archived: boolean | null
          character: string | null
          created_at: string | null
          id: number | null
          kind: string | null
          memo: string | null
          name: string | null
          position: string | null
          preset_key: string | null
          recovery: string | null
          updated_at: string | null
        }
        Insert: {
          advantage?: number | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          id?: number | null
          kind?: string | null
          memo?: string | null
          name?: string | null
          position?: string | null
          preset_key?: string | null
          recovery?: string | null
          updated_at?: string | null
        }
        Update: {
          advantage?: number | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          id?: number | null
          kind?: string | null
          memo?: string | null
          name?: string | null
          position?: string | null
          preset_key?: string | null
          recovery?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sf6_backup_20261025b_sequence_results: {
        Row: {
          hit_type: string | null
          id: number | null
          kind: string | null
          next_situation_id: number | null
          opponent_action: string | null
          outcome: string | null
          sequence_id: number | null
        }
        Insert: {
          hit_type?: string | null
          id?: number | null
          kind?: string | null
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id?: number | null
        }
        Update: {
          hit_type?: string | null
          id?: number | null
          kind?: string | null
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id?: number | null
        }
        Relationships: []
      }
      sf6_backup_20261025b_sequence_starts: {
        Row: {
          sequence_id: number | null
          situation_id: number | null
        }
        Insert: {
          sequence_id?: number | null
          situation_id?: number | null
        }
        Update: {
          sequence_id?: number | null
          situation_id?: number | null
        }
        Relationships: []
      }
      sf6_backup_20261025b_sequences: {
        Row: {
          aim: string | null
          archived: boolean | null
          character: string | null
          created_at: string | null
          damage: number | null
          drive_cost: number | null
          end_purpose: string | null
          id: number | null
          kind: string | null
          layering: string | null
          mastery: number | null
          memo: string | null
          notation: string | null
          position: string | null
          sa_cost: number | null
          startup: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          aim?: string | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          damage?: number | null
          drive_cost?: number | null
          end_purpose?: string | null
          id?: number | null
          kind?: string | null
          layering?: string | null
          mastery?: number | null
          memo?: string | null
          notation?: string | null
          position?: string | null
          sa_cost?: number | null
          startup?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          aim?: string | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          damage?: number | null
          drive_cost?: number | null
          end_purpose?: string | null
          id?: number | null
          kind?: string | null
          layering?: string | null
          mastery?: number | null
          memo?: string | null
          notation?: string | null
          position?: string | null
          sa_cost?: number | null
          startup?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sf6_backup_20261025b_situations: {
        Row: {
          advantage: number | null
          archived: boolean | null
          character: string | null
          created_at: string | null
          id: number | null
          kind: string | null
          memo: string | null
          name: string | null
          position: string | null
          preset_key: string | null
          recovery: string | null
          throw_range: boolean | null
          updated_at: string | null
        }
        Insert: {
          advantage?: number | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          id?: number | null
          kind?: string | null
          memo?: string | null
          name?: string | null
          position?: string | null
          preset_key?: string | null
          recovery?: string | null
          throw_range?: boolean | null
          updated_at?: string | null
        }
        Update: {
          advantage?: number | null
          archived?: boolean | null
          character?: string | null
          created_at?: string | null
          id?: number | null
          kind?: string | null
          memo?: string | null
          name?: string | null
          position?: string | null
          preset_key?: string | null
          recovery?: string | null
          throw_range?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sf6_drill_logs: {
        Row: {
          attempts: number | null
          best_streak: number | null
          created_at: string
          drill_id: number
          id: number
          note: string | null
          practiced_on: string
          successes: number | null
        }
        Insert: {
          attempts?: number | null
          best_streak?: number | null
          created_at?: string
          drill_id: number
          id?: number
          note?: string | null
          practiced_on: string
          successes?: number | null
        }
        Update: {
          attempts?: number | null
          best_streak?: number | null
          created_at?: string
          drill_id?: number
          id?: number
          note?: string | null
          practiced_on?: string
          successes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sf6_drill_logs_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "sf6_drills"
            referencedColumns: ["id"]
          },
        ]
      }
      sf6_drills: {
        Row: {
          counter_setting: string | null
          created_at: string
          detail: string | null
          guard_setting: string | null
          id: number
          recovery_setting: string | null
          reversal_recorded: boolean
          sequence_ids: number[]
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          counter_setting?: string | null
          created_at?: string
          detail?: string | null
          guard_setting?: string | null
          id?: number
          recovery_setting?: string | null
          reversal_recorded?: boolean
          sequence_ids?: number[]
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          counter_setting?: string | null
          created_at?: string
          detail?: string | null
          guard_setting?: string | null
          id?: number
          recovery_setting?: string | null
          reversal_recorded?: boolean
          sequence_ids?: number[]
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sf6_matches: {
        Row: {
          bad: string | null
          created_at: string
          good: string | null
          id: number
          mode: string
          my_character: string
          opponent: string
          played_on: string
          result: string
          updated_at: string
        }
        Insert: {
          bad?: string | null
          created_at?: string
          good?: string | null
          id?: number
          mode?: string
          my_character: string
          opponent: string
          played_on: string
          result: string
          updated_at?: string
        }
        Update: {
          bad?: string | null
          created_at?: string
          good?: string | null
          id?: number
          mode?: string
          my_character?: string
          opponent?: string
          played_on?: string
          result?: string
          updated_at?: string
        }
        Relationships: []
      }
      sf6_move_sets: {
        Row: {
          character: string
          checked_on: string
          created_at: string
          data_version: string
          move_count: number
          source_url: string
          updated_at: string
        }
        Insert: {
          character: string
          checked_on: string
          created_at?: string
          data_version: string
          move_count?: number
          source_url: string
          updated_at?: string
        }
        Update: {
          character?: string
          checked_on?: string
          created_at?: string
          data_version?: string
          move_count?: number
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      sf6_moves: {
        Row: {
          active_text: string | null
          attribute_text: string | null
          block_text: string | null
          cancel_text: string | null
          category: string
          character: string
          command: string | null
          counter_override: string | null
          damage_text: string | null
          drive_gain_text: string | null
          drive_loss_text: string | null
          hit_knockdown: boolean
          hit_text: string | null
          id: number
          name: string
          notes: string | null
          on_block: number | null
          on_hit: number | null
          punish_counter_override: string | null
          recovery_text: string | null
          sa_gain_text: string | null
          scaling_text: string | null
          sort_order: number
          startup: number | null
          startup_text: string | null
        }
        Insert: {
          active_text?: string | null
          attribute_text?: string | null
          block_text?: string | null
          cancel_text?: string | null
          category: string
          character: string
          command?: string | null
          counter_override?: string | null
          damage_text?: string | null
          drive_gain_text?: string | null
          drive_loss_text?: string | null
          hit_knockdown?: boolean
          hit_text?: string | null
          id?: number
          name: string
          notes?: string | null
          on_block?: number | null
          on_hit?: number | null
          punish_counter_override?: string | null
          recovery_text?: string | null
          sa_gain_text?: string | null
          scaling_text?: string | null
          sort_order: number
          startup?: number | null
          startup_text?: string | null
        }
        Update: {
          active_text?: string | null
          attribute_text?: string | null
          block_text?: string | null
          cancel_text?: string | null
          category?: string
          character?: string
          command?: string | null
          counter_override?: string | null
          damage_text?: string | null
          drive_gain_text?: string | null
          drive_loss_text?: string | null
          hit_knockdown?: boolean
          hit_text?: string | null
          id?: number
          name?: string
          notes?: string | null
          on_block?: number | null
          on_hit?: number | null
          punish_counter_override?: string | null
          recovery_text?: string | null
          sa_gain_text?: string | null
          scaling_text?: string | null
          sort_order?: number
          startup?: number | null
          startup_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sf6_moves_character_fkey"
            columns: ["character"]
            isOneToOne: false
            referencedRelation: "sf6_move_sets"
            referencedColumns: ["character"]
          },
        ]
      }
      sf6_sequence_results: {
        Row: {
          hit_type: string | null
          id: number
          kind: string
          next_situation_id: number | null
          opponent_action: string | null
          outcome: string | null
          sequence_id: number
        }
        Insert: {
          hit_type?: string | null
          id?: number
          kind: string
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id: number
        }
        Update: {
          hit_type?: string | null
          id?: number
          kind?: string
          next_situation_id?: number | null
          opponent_action?: string | null
          outcome?: string | null
          sequence_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sf6_sequence_results_next_situation_id_fkey"
            columns: ["next_situation_id"]
            isOneToOne: false
            referencedRelation: "sf6_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sf6_sequence_results_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sf6_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sf6_sequence_starts: {
        Row: {
          sequence_id: number
          situation_id: number
        }
        Insert: {
          sequence_id: number
          situation_id: number
        }
        Update: {
          sequence_id?: number
          situation_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sf6_sequence_starts_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sf6_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sf6_sequence_starts_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "sf6_situations"
            referencedColumns: ["id"]
          },
        ]
      }
      sf6_sequences: {
        Row: {
          archived: boolean
          character: string
          created_at: string
          drive_cost: number
          id: number
          layering: string | null
          mastery: number
          memo: string | null
          notation: string
          position: string
          sa_cost: number
          startup: number | null
          title: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          character: string
          created_at?: string
          drive_cost?: number
          id?: number
          layering?: string | null
          mastery?: number
          memo?: string | null
          notation: string
          position?: string
          sa_cost?: number
          startup?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          character?: string
          created_at?: string
          drive_cost?: number
          id?: number
          layering?: string | null
          mastery?: number
          memo?: string | null
          notation?: string
          position?: string
          sa_cost?: number
          startup?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sf6_situations: {
        Row: {
          advantage: number | null
          archived: boolean
          character: string | null
          created_at: string
          id: number
          kind: string
          memo: string | null
          name: string
          position: string
          preset_key: string | null
          recovery: string | null
          throw_range: boolean
          updated_at: string
        }
        Insert: {
          advantage?: number | null
          archived?: boolean
          character?: string | null
          created_at?: string
          id?: number
          kind: string
          memo?: string | null
          name: string
          position?: string
          preset_key?: string | null
          recovery?: string | null
          throw_range?: boolean
          updated_at?: string
        }
        Update: {
          advantage?: number | null
          archived?: boolean
          character?: string | null
          created_at?: string
          id?: number
          kind?: string
          memo?: string | null
          name?: string
          position?: string
          preset_key?: string | null
          recovery?: string | null
          throw_range?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      speaking_practice_log: {
        Row: {
          answer_text: string | null
          attempt_id: string
          id: number
          knowledge_id: string
          practice_type: string
          practiced_at: string
          rating: string
          repetitions: number
          session_id: string
        }
        Insert: {
          answer_text?: string | null
          attempt_id: string
          id?: number
          knowledge_id: string
          practice_type: string
          practiced_at?: string
          rating: string
          repetitions?: number
          session_id: string
        }
        Update: {
          answer_text?: string | null
          attempt_id?: string
          id?: number
          knowledge_id?: string
          practice_type?: string
          practiced_at?: string
          rating?: string
          repetitions?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaking_practice_log_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_material_exclusions: {
        Row: {
          excluded_at: string
          source_id: string
          source_type: string
          tag: string
        }
        Insert: {
          excluded_at?: string
          source_id: string
          source_type: string
          tag: string
        }
        Update: {
          excluded_at?: string
          source_id?: string
          source_type?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_material_exclusions_tag_fkey"
            columns: ["tag"]
            isOneToOne: false
            referencedRelation: "knowledge_tag_vocabulary"
            referencedColumns: ["tag"]
          },
        ]
      }
      want_routes: {
        Row: {
          cadence: string | null
          created_at: string
          destination: string
          destination_data: Json
          detail: string | null
          error_code: string | null
          id: number
          idempotency_key: string
          intent: string
          status: string
          target_id: string | null
          target_url: string | null
          title: string
          updated_at: string
          want_id: number
        }
        Insert: {
          cadence?: string | null
          created_at?: string
          destination: string
          destination_data?: Json
          detail?: string | null
          error_code?: string | null
          id?: number
          idempotency_key: string
          intent: string
          status?: string
          target_id?: string | null
          target_url?: string | null
          title: string
          updated_at?: string
          want_id: number
        }
        Update: {
          cadence?: string | null
          created_at?: string
          destination?: string
          destination_data?: Json
          detail?: string | null
          error_code?: string | null
          id?: number
          idempotency_key?: string
          intent?: string
          status?: string
          target_id?: string | null
          target_url?: string | null
          title?: string
          updated_at?: string
          want_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "want_routes_want_id_fkey"
            columns: ["want_id"]
            isOneToOne: false
            referencedRelation: "due_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "want_routes_want_id_fkey"
            columns: ["want_id"]
            isOneToOne: false
            referencedRelation: "wants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "want_routes_want_id_fkey"
            columns: ["want_id"]
            isOneToOne: false
            referencedRelation: "wants_view"
            referencedColumns: ["id"]
          },
        ]
      }
      wants: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: number
          idempotency_key: string | null
          note: string | null
          revisit_count: number
          revisit_on: string | null
          source_inbox_id: number | null
          status: string
          type: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: never
          idempotency_key?: string | null
          note?: string | null
          revisit_count?: number
          revisit_on?: string | null
          source_inbox_id?: number | null
          status?: string
          type?: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: never
          idempotency_key?: string | null
          note?: string | null
          revisit_count?: number
          revisit_on?: string | null
          source_inbox_id?: number | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wants_source_inbox_id_fkey"
            columns: ["source_inbox_id"]
            isOneToOne: false
            referencedRelation: "idea_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wants_source_inbox_id_fkey"
            columns: ["source_inbox_id"]
            isOneToOne: false
            referencedRelation: "idea_inbox_pending_view"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_topics: {
        Row: {
          created_at: string
          draft_url: string | null
          id: number
          next_review_on: string | null
          notes: string | null
          question: string | null
          source_route_id: number
          source_want_id: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_url?: string | null
          id?: number
          next_review_on?: string | null
          notes?: string | null
          question?: string | null
          source_route_id: number
          source_want_id: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_url?: string | null
          id?: number
          next_review_on?: string | null
          notes?: string | null
          question?: string | null
          source_route_id?: number
          source_want_id?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_topics_source_route_id_fkey"
            columns: ["source_route_id"]
            isOneToOne: true
            referencedRelation: "want_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_topics_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "due_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_topics_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_topics_source_want_id_fkey"
            columns: ["source_want_id"]
            isOneToOne: false
            referencedRelation: "wants_view"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      due_reviews: {
        Row: {
          content: string | null
          created_at: string | null
          id: number | null
          note: string | null
          revisit_count: number | null
          revisit_on: string | null
          type: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: number | null
          note?: string | null
          revisit_count?: number | null
          revisit_on?: string | null
          type?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: number | null
          note?: string | null
          revisit_count?: number | null
          revisit_on?: string | null
          type?: string | null
        }
        Relationships: []
      }
      idea_inbox_pending_view: {
        Row: {
          content: string | null
          created_at: string | null
          id: number | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: number | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: number | null
        }
        Relationships: []
      }
      personal_profile_for_ai: {
        Row: {
          category: string | null
          current: boolean | null
          detail: string | null
          id: number | null
          name: string | null
          since: string | null
          until: string | null
          updated_at: string | null
          value: string | null
        }
        Insert: {
          category?: string | null
          current?: never
          detail?: string | null
          id?: number | null
          name?: string | null
          since?: string | null
          until?: string | null
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          category?: string | null
          current?: never
          detail?: string | null
          id?: number | null
          name?: string | null
          since?: string | null
          until?: string | null
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      wants_view: {
        Row: {
          content: string | null
          created_at: string | null
          id: number | null
          note: string | null
          revisit_count: number | null
          revisit_on: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: number | null
          note?: string | null
          revisit_count?: number | null
          revisit_on?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: number | null
          note?: string | null
          revisit_count?: number | null
          revisit_on?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_insight_group_members: {
        Args: {
          p_expected_updated_at: string
          p_group_id: number
          p_insight_ids: number[]
        }
        Returns: Json
      }
      add_project_queued_action: {
        Args: {
          p_content: string
          p_project_id: number
          p_project_updated_at: string
        }
        Returns: number
      }
      add_project_queued_actions: {
        Args: {
          p_contents: string[]
          p_milestone_id: number
          p_project_id: number
          p_project_updated_at: string
        }
        Returns: number
      }
      assign_auto_tags: {
        Args: { p_limit?: number; p_model: string }
        Returns: number
      }
      attach_review_generation_jobs: {
        Args: {
          p_run_id: number
        }
        Returns: undefined
      }
      begin_review_batch: {
        Args: { p_kind: string; p_trigger: string }
        Returns: number
      }
      bulk_categorize_expenses: {
        Args: {
          p_category: string
          p_items: Json
        }
        Returns: Json
      }
      claim_relearning_generation: {
        Args: never
        Returns: number | null
      }
      claim_review_answers: {
        Args: { p_limit?: number }
        Returns: {
          answer_text: string
          answered_at: string
          choices: Json
          correct_choice: string
          format: string
          grade_attempts: number
          id: number
          knowledge_id: string
          prepared_explanation: string
          question: string
        }[]
      }
      complete_inbox_route: {
        Args: {
          p_idempotency_key: string
          p_target_id: string
          p_target_url?: string
        }
        Returns: Json
      }
      confirm_review_results: {
        Args: { p_quiz_log_ids: number[] }
        Returns: number
      }
      consume_dashboard_handoff_nonce: {
        Args: { p_expires_at: number; p_nonce: string }
        Returns: boolean
      }
      create_project_from_source: {
        Args: {
          p_next_action: string
          p_outcome: string
          p_source_content: string
          p_source_id: number
          p_source_result: string
          p_source_status: string
          p_source_type: string
          p_target_on: string
          p_theme: string
          p_title: string
        }
        Returns: number
      }
      create_project_with_next_action: {
        Args: {
          p_next_action: string
          p_outcome: string
          p_target_on: string
          p_theme: string
          p_title: string
        }
        Returns: number
      }
      create_recurring_expense_rule:
        | {
            Args: {
              p_end_date?: string
              p_frequency: string
              p_interval_count?: number
              p_source_expense_id: number
            }
            Returns: {
              active: boolean
              amount: number
              category: string
              created_at: string
              day_of_month: number
              end_date: string | null
              frequency: string
              id: number
              interval_count: number
              last_generated_at: string | null
              memo: string | null
              next_run_date: string
              payer: string | null
              source_expense_id: number | null
              start_date: string
              template_rule_id: number | null
              title: string
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "recurring_expenses"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_amount: number
              p_category: string
              p_end_date: string
              p_frequency: string
              p_interval_count: number
              p_memo: string
              p_payer: string
              p_start_date: string
              p_template_rule_id: number
              p_title: string
            }
            Returns: {
              active: boolean
              amount: number
              category: string
              created_at: string
              day_of_month: number
              end_date: string | null
              frequency: string
              id: number
              interval_count: number
              last_generated_at: string | null
              memo: string | null
              next_run_date: string
              payer: string | null
              source_expense_id: number | null
              start_date: string
              template_rule_id: number | null
              title: string
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "recurring_expenses"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      daily_review_new_card_ids: {
        Args: never
        Returns: {
          id: string
        }[]
      }
      delete_unlinked_scheduled_actions: {
        Args: { p_ids: number[]; p_synced_at: string }
        Returns: number
      }
      direct_quiz_categories: { Args: never; Returns: Json }
      direct_quiz_queue_discard: {
        Args: { p_item_ids: number[] }
        Returns: number
      }
      direct_quiz_queue_health: { Args: never; Returns: Json }
      direct_quiz_queue_pick: {
        Args: { p_include?: string[]; p_limit?: number }
        Returns: Json
      }
      direct_quiz_queue_record: { Args: { p_answers: Json }; Returns: Json }
      direct_quiz_queue_status: { Args: never; Returns: Json }
      discard_review_question: { Args: { p_item_id: number }; Returns: string }
      discard_stale_review_questions: { Args: never; Returns: number }
      enqueue_review_questions: { Args: { p_items: Json }; Returns: number }
      fail_inbox_route: {
        Args: { p_error_code: string; p_idempotency_key: string }
        Returns: Json
      }
      finish_project_next_action: {
        Args: {
          p_action_id: number
          p_completed_at: string
          p_resolution: Json
          p_terminal: string
        }
        Returns: number
      }
      finish_review_ai_batch: {
        Args: { p_id: number; p_note: string; p_status: string }
        Returns: boolean
      }
      finish_review_batch: {
        Args: {
          p_failed?: number
          p_note?: string
          p_processed?: number
          p_run_id: number
          p_status: string
          p_succeeded?: number
        }
        Returns: undefined
      }
      finish_review_generation_jobs: {
        Args: {
          p_run_id: number
          p_succeeded: boolean
        }
        Returns: undefined
      }
      get_daily_review_status: {
        Args: { p_limit?: number }
        Returns: {
          completed: number
          completed_unique: number
          due_total: number
          new_held: number
          new_limit: number
          next_retry_at: string
          overdue_total: number
          queue_limit: number
          queue_total: number
          remaining: number
          remaining_by_category: Json
          retry_ready: number
          retry_waiting: number
          review_on: string
        }[]
      }
      get_database_usage: { Args: never; Returns: Json }
      get_finance_expense_page: {
        Args: {
          p_amount_max?: number | null
          p_amount_min?: number | null
          p_categories?: string[] | null
          p_category_mode?: string
          p_count?: boolean
          p_from?: string | null
          p_limit?: number
          p_month: string
          p_offset?: number
          p_payer?: string | null
          p_query?: string
          p_sort?: string
          p_to?: string | null
          p_type?: string
          p_voided?: boolean
        }
        Returns: Json
      }
      get_finance_hub_summary: {
        Args: {
          p_today: string
        }
        Returns: Json
      }
      get_finance_overview: {
        Args: {
          p_categories?: string[] | null
          p_category_mode?: string
          p_month: string
          p_payer?: string | null
        }
        Returns: Json
      }
      get_hub_local_summary: {
        Args: {
          p_source: string
          p_today: string
        }
        Returns: Json
      }
      get_idea_read_model: {
        Args: {
          p_category?: string
          p_filter?: string
          p_id?: number | null
          p_limit?: number
          p_offset?: number
          p_route_offset?: number
          p_search?: string
          p_status?: string
          p_today?: string
          p_view?: string
        }
        Returns: Json
      }
      get_inbox_triage_summary: {
        Args: {
          p_inbox_id: number
        }
        Returns: Json
      }
      get_knowledge_hub_summary: {
        Args: {
          p_today?: string
        }
        Returns: Json
      }
      get_learning_log_page: {
        Args: {
          p_category?: string | null
          p_from?: string | null
          p_ids?: number[] | null
          p_knowledge_id?: string | null
          p_limit?: number
          p_misses?: boolean
          p_offset?: number
          p_unconfirmed?: boolean
          p_verdict?: string | null
        }
        Returns: Json
      }
      get_learning_summary: {
        Args: {
          p_today?: string
        }
        Returns: Json
      }
      get_project_read_model: {
        Args: {
          p_attention?: boolean
          p_history_limit?: number
          p_history_offset?: number
          p_item_offset?: number
          p_limit?: number
          p_offset?: number
          p_project_id?: number | null
          p_search?: string
          p_sort?: string
          p_today?: string
          p_view?: string
        }
        Returns: Json
      }
      get_recent_quiz_notes: {
        Args: { p_knowledge_ids: string[]; p_per_item?: number }
        Returns: {
          asked_on: string
          knowledge_id: string
          note: string
          quality: number
          verdict: string
        }[]
      }
      get_review_batch_health: { Args: never; Returns: Json }
      get_review_queue_status: {
        Args: never
        Returns: {
          generation_held: number
          grading_errors: number
          last_generate_added: number
          last_generate_at: string
          last_generate_note: string
          last_generate_status: string
          last_grade_at: string
          last_grade_status: string
          queue_full: boolean
          queue_limit: number
          ready_due: number
          ready_total: number
          unconfirmed_results: number
          waiting_grading: number
        }[]
      }
      get_scheduled_action_counts: {
        Args: never
        Returns: Json
      }
      get_semantic_index_status: {
        Args: { p_model: string }
        Returns: {
          embedded: number
          last_embedded_at: string
          source_type: string
          total: number
        }[]
      }
      hold_review_generation_failures: {
        Args: { p_items: Json }
        Returns: number
      }
      inbox_route_calendar_param: { Args: { p_value: Json }; Returns: Json }
      inbox_route_contract: { Args: never; Returns: Json }
      inbox_route_contract_before_sf6: { Args: never; Returns: Json }
      inbox_route_date_param: {
        Args: { p_key: string; p_params: Json; p_required: boolean }
        Returns: string
      }
      inbox_route_response: {
        Args: {
          p_exit: string
          p_inbox_id: number
          p_project_id: number
          p_replayed: boolean
          p_route_id: number
          p_state: string
          p_want_id: number
        }
        Returns: Json
      }
      inbox_route_text_param: {
        Args: {
          p_key: string
          p_max: number
          p_params: Json
          p_required: boolean
        }
        Returns: string
      }
      inbox_sf6_result: {
        Args: {
          p_replayed: boolean
          p_route: Database["public"]["Tables"]["inbox_sf6_routes"]["Row"]
        }
        Returns: Json
      }
      inbox_sf6_valid_ref: { Args: { p_ref: Json }; Returns: boolean }
      inbox_sf6_validate_payload: {
        Args: { p_payload: Json; p_resource: string }
        Returns: undefined
      }
      jst_today: { Args: never; Returns: string }
      learning_log_matches: {
        Args: {
          p_category?: string | null
          p_from?: string | null
          p_knowledge_id?: string | null
          p_unconfirmed?: boolean
          p_verdict?: string | null
        }
        Returns: Database["public"]["Tables"]["quiz_log"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "quiz_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      link_project_action_todo: { Args: { p_request: Json }; Returns: number }
      link_project_source: {
        Args: {
          p_project_id: number
          p_project_updated_at: string
          p_source_content: string
          p_source_id: number
          p_source_result: string
          p_source_status: string
          p_source_type: string
        }
        Returns: number
      }
      list_note_topics: {
        Args: {
          p_model: string
          p_question_min_similarity?: number
          p_question_per_type?: number
          p_theme_min_similarity?: number
          p_theme_per_type?: number
        }
        Returns: {
          guiding_question: string
          insight_count: number
          journal_count: number
          key: string
          kind: string
          knowledge_count: number
          materials_ready: boolean
          title: string
        }[]
      }
      list_pending_review_ai_batches: {
        Args: { p_kind: string }
        Returns: {
          created_at: string
          id: number
          item_ids: number[]
          knowledge_ids: string[]
          payload: Json
          provider_batch_id: string
        }[]
      }
      list_question_exclusions: {
        Args: { p_group_id: number }
        Returns: {
          body: string
          excluded_at: string
          source_id: string
          source_type: string
          title: string
        }[]
      }
      list_question_materials: {
        Args: { p_group_id: number; p_model: string; p_per_type?: number }
        Returns: {
          body: string
          entry_date: string
          knowledge_id: string
          meta: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      list_review_generation_holds: {
        Args: never
        Returns: {
          category: string
          failure_count: number
          knowledge_id: string
          last_failed_at: string
          last_question: string
          last_reason: string
          retry_after: string
          title: string
        }[]
      }
      list_theme_exclusions: {
        Args: { p_tag: string }
        Returns: {
          body: string
          excluded_at: string
          source_id: string
          source_type: string
          title: string
        }[]
      }
      list_theme_materials: {
        Args: {
          p_min_similarity?: number
          p_model: string
          p_per_type?: number
          p_tag: string
        }
        Returns: {
          body: string
          entry_date: string
          knowledge_id: string
          meta: string
          origin: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      lock_project_action_group: {
        Args: { p_action_id: number }
        Returns: number
      }
      materialize_recurring_expenses: {
        Args: { p_through_date?: string }
        Returns: number
      }
      next_recurring_date: {
        Args: {
          p_date: string
          p_day_of_month: number
          p_frequency: string
          p_interval: number
        }
        Returns: string
      }
      pick_quiz: {
        Args: {
          p_exclude?: string[]
          p_include?: string[]
          p_include_mastered?: boolean
          p_limit?: number
        }
        Returns: {
          category: string
          ef: number
          explanation: string
          id: string
          interval_days: number
          mastery: string
          mastery_streak: number
          next_review_at: string
          next_review_on: string
          overdue_days: number
          pool: string
          relearning_stage: string
          reps: number
          stability_hours: number
          times_asked: number
          title: string
        }[]
      }
      pick_review_generation_candidates: {
        Args: { p_limit?: number; p_relearning_only?: boolean }
        Returns: {
          category: string
          content_version: number
          explanation: string
          id: string
          mastery: string
          pool: string
          relearning_stage: string
          stability_hours: number
          tags: string[]
          times_asked: number
          title: string
        }[]
      }
      pick_review_generation_candidates_ahead: {
        Args: {
          p_limit: number
          p_lookahead_minutes: number
          p_relearning_only: boolean
        }
        Returns: {
          category: string
          content_version: number
          explanation: string
          id: string
          mastery: string
          pool: string
          relearning_stage: string
          stability_hours: number
          tags: string[]
          times_asked: number
          title: string
        }[]
      }
      pick_semantic_embedding_targets: {
        Args: { p_limit: number; p_model: string }
        Returns: {
          input_hash: string
          input_text: string
          source_id: string
          source_type: string
        }[]
      }
      process_project_item: {
        Args: {
          p_action_content: string
          p_project_item_id: number
          p_project_item_updated_at: string
          p_project_updated_at: string
          p_treatment: string
        }
        Returns: number
      }
      prune_dashboard_handoff_nonce: { Args: never; Returns: number }
      question_material_state: {
        Args: { p_group_id: number; p_model: string }
        Returns: {
          group_id: number
          guiding_question: string
          input_hash: string
          needs_embedding: boolean
        }[]
      }
      record_answer: {
        Args: {
          p_answered_at?: string
          p_format?: string
          p_knowledge_id: string
          p_note?: string
          p_quality: number
          p_verdict: string
        }
        Returns: {
          accuracy: number | null
          archived: boolean
          base_interval_days: number
          category: string
          claim_evidence: string | null
          content_version: number
          created_at: string
          ef: number
          explanation: string | null
          id: string
          interval_days: number
          knowledge_kind: string
          last_asked_on: string | null
          last_reviewed_at: string | null
          learned_on: string
          mastery: string
          mastery_streak: number
          next_review_at: string
          next_review_on: string | null
          notion_id: string | null
          priority: string
          relearning_penalized: boolean
          relearning_quality: number | null
          relearning_stage: string | null
          reps: number
          scheduled_from_at: string | null
          source_note: string | null
          stability_hours: number
          tags: string[]
          times_asked: number
          times_correct: number
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "knowledge"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_answers_batch: {
        Args: { p_answers: Json }
        Returns: {
          accuracy: number | null
          archived: boolean
          base_interval_days: number
          category: string
          claim_evidence: string | null
          content_version: number
          created_at: string
          ef: number
          explanation: string | null
          id: string
          interval_days: number
          knowledge_kind: string
          last_asked_on: string | null
          last_reviewed_at: string | null
          learned_on: string
          mastery: string
          mastery_streak: number
          next_review_at: string
          next_review_on: string | null
          notion_id: string | null
          priority: string
          relearning_penalized: boolean
          relearning_quality: number | null
          relearning_stage: string | null
          reps: number
          scheduled_from_at: string | null
          source_note: string | null
          stability_hours: number
          tags: string[]
          times_asked: number
          times_correct: number
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_answers_batch_once: {
        Args: { p_answers: Json }
        Returns: {
          id: string
          next_review_at: string
          next_review_on: string
          recorded: boolean
          relearning_stage: string
          schedule_updated: boolean
          stability_hours: number
        }[]
      }
      record_project_todo_read_cache: {
        Args: {
          p_items: Json
        }
        Returns: undefined
      }
      record_review_grade: {
        Args: {
          p_correct_answer: string
          p_explanation: string
          p_item_id: number
          p_note: string
          p_quality: number
          p_verdict: string
        }
        Returns: {
          item_id: number
          next_review_at: string
          quiz_log_id: number
          recorded: boolean
          status: string
        }[]
      }
      record_review_grades_batch: {
        Args: {
          p_errors?: Json
          p_grades: Json
        }
        Returns: {
          error: string | null
          item_id: number
          recorded: boolean
          relearning: boolean
          status: string
        }[]
      }
      record_speaking_practice: {
        Args: {
          p_answer_text?: string
          p_attempt_id: string
          p_knowledge_id: string
          p_practice_type: string
          p_rating: string
          p_repetitions?: number
          p_session_id: string
        }
        Returns: {
          answer_text: string | null
          attempt_id: string
          id: number
          knowledge_id: string
          practice_type: string
          practiced_at: string
          rating: string
          repetitions: number
          session_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "speaking_practice_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      register_review_ai_batch: {
        Args: {
          p_item_ids: number[]
          p_kind: string
          p_knowledge_ids: string[]
          p_payload: Json
          p_provider_batch_id: string
        }
        Returns: number
      }
      related_knowledge: {
        Args: {
          p_knowledge_id: string
          p_min_similarity?: number
          p_model: string
          p_per_kind?: number
        }
        Returns: {
          body: string
          item_id: string
          kind: string
          knowledge_id: string
          similarity: number
          title: string
        }[]
      }
      release_review_answer: {
        Args: { p_error: string; p_item_id: number }
        Returns: string
      }
      reorder_focus_items: {
        Args: { p_ids: number[]; p_original_ids: number[] }
        Returns: {
          content: string
          created_at: string
          id: number
          note: string | null
          sort_order: number | null
          source_route_id: number
          source_want_id: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "focus_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_personal_profile: {
        Args: {
          p_category: string
          p_detail?: string
          p_name: string
          p_since?: string
          p_value: string
        }
        Returns: {
          ai_visible: boolean
          category: string
          created_at: string
          detail: string | null
          id: number
          name: string
          since: string | null
          until: string | null
          updated_at: string
          value: string
        }
        SetofOptions: {
          from: "*"
          to: "personal_profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_project_next_action: {
        Args: {
          p_action_id: number
          p_action_updated_at: string
          p_next_action_content: string
          p_next_action_id: number
          p_resolution: string
          p_review_on: string
          p_waiting_for: string
        }
        Returns: number
      }
      resolve_project_next_action_with_todo: {
        Args: {
          p_action_id: number
          p_action_updated_at: string
          p_next_action_content: string
          p_next_action_id: number
          p_resolution: string
          p_review_on: string
          p_terminal: string
          p_todo_id: number
          p_todo_status: string
          p_todo_updated_at: string
          p_waiting_for: string
        }
        Returns: number
      }
      resume_project_with_next_action: {
        Args: {
          p_next_action: string
          p_project_id: number
          p_project_updated_at: string
        }
        Returns: number
      }
      retry_review_answer: { Args: { p_item_id: number }; Returns: string }
      review_batch_kind_health: { Args: { p_kind: string }; Returns: Json }
      review_generation_backoff: {
        Args: { p_failure_count: number }
        Returns: string
      }
      review_generation_batch_size: { Args: never; Returns: number }
      review_grading_max_attempts: { Args: never; Returns: number }
      review_interval_for_priority: {
        Args: { p_base_interval: number; p_priority: string }
        Returns: number
      }
      review_new_cards_per_day: { Args: never; Returns: number }
      review_new_cards_remaining_today: { Args: never; Returns: number }
      review_priority_factor: { Args: { p_priority: string }; Returns: number }
      review_queue_limit: { Args: never; Returns: number }
      review_relearning_step_hours: {
        Args: { p_quality: number }
        Returns: number
      }
      route_inbox_item: {
        Args: {
          p_exit: string
          p_idempotency_key: string
          p_inbox_id: number
          p_params: Json
        }
        Returns: Json
      }
      route_inbox_sf6: {
        Args: { p_idempotency_key: string; p_inbox_id: number; p_params: Json }
        Returns: Json
      }
      save_question_embedding: {
        Args: {
          p_embedding: string
          p_group_id: number
          p_input_hash: string
          p_model: string
        }
        Returns: boolean
      }
      save_semantic_embeddings: {
        Args: { p_items: Json; p_model: string }
        Returns: number
      }
      search_archived_knowledge: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      search_semantic: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_model: string
          p_types?: string[]
        }
        Returns: {
          body: string
          entry_date: string
          knowledge_id: string
          meta: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      semantic_sources: {
        Args: never
        Returns: {
          archived: boolean
          body: string
          entry_date: string
          input_hash: string
          input_text: string
          knowledge_id: string
          meta: string
          source_id: string
          source_type: string
          title: string
        }[]
      }
      serve_review_queue: {
        Args: { p_categories?: string[]; p_limit?: number }
        Returns: {
          category: string
          choices: Json
          format: string
          id: number
          knowledge_id: string
          pool: string
          question: string
        }[]
      }
      serve_review_queue_filtered: {
        Args: {
          p_categories?: string[]
          p_knowledge_ids?: string[]
          p_limit?: number
        }
        Returns: {
          category: string
          choices: Json
          format: string
          id: number
          knowledge_id: string
          pool: string
          question: string
        }[]
      }
      set_recurring_expense_active: {
        Args: { p_active: boolean; p_id: number }
        Returns: {
          active: boolean
          amount: number
          category: string
          created_at: string
          day_of_month: number
          end_date: string | null
          frequency: string
          id: number
          interval_count: number
          last_generated_at: string | null
          memo: string | null
          next_run_date: string
          payer: string | null
          source_expense_id: number | null
          start_date: string
          template_rule_id: number | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recurring_expenses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sf6_delete_sequence: { Args: { p_id: number }; Returns: number }
      sf6_resolve_situation: {
        Args: { p_character: string; p_ref: Json }
        Returns: number
      }
      sf6_save_sequence: {
        Args: {
          p_id: number
          p_results: Json
          p_row: Json
          p_starts: Json
          p_updated_at: string
        }
        Returns: number
      }
      snapshot_review_result_ids: {
        Args: {
          p_category?: string | null
          p_from?: string | null
          p_misses?: boolean
          p_verdict?: string | null
        }
        Returns: Json
      }
      submit_review_answer: {
        Args: { p_answer: string; p_item_id: number }
        Returns: {
          accepted: boolean
          answer_text: string
          answered_at: string
          choices: Json
          correct_choice: string
          expected_answer: string
          format: string
          id: number
          knowledge_id: string
          prepared_explanation: string
          question: string
          status: string
        }[]
      }
      swap_focus_items: {
        Args: { p_activate_id: number; p_archive_id: number }
        Returns: {
          content: string
          created_at: string
          id: number
          note: string | null
          sort_order: number | null
          source_route_id: number
          source_want_id: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "focus_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      theme_material_keys: {
        Args: {
          p_min_similarity?: number
          p_model: string
          p_per_type?: number
        }
        Returns: {
          origin: string
          similarity: number
          source_id: string
          source_type: string
          tag: string
        }[]
      }
      theme_material_keys_for_tag: {
        Args: {
          p_min_similarity?: number
          p_model: string
          p_per_type?: number
          p_tag?: string | null
        }
        Returns: {
          origin: string
          similarity: number
          source_id: string
          source_type: string
          tag: string
        }[]
      }
      trigger_embedding_batch: { Args: never; Returns: number }
      trigger_review_batch: { Args: { p_kind: string }; Returns: number }
      unlink_project_action_todo: { Args: { p_request: Json }; Returns: number }
      update_linked_todo: { Args: { p_request: Json }; Returns: Json }
      update_project_action: {
        Args: {
          p_action_id: number
          p_action_updated_at: string
          p_content: string
          p_due_on: string
          p_milestone_id?: number
          p_operation: string
          p_start_on: string
        }
        Returns: number
      }
      update_project_action_with_todo: {
        Args: {
          p_action_id: number
          p_action_updated_at: string
          p_content: string
          p_due_on: string
          p_milestone_id: number
          p_operation: string
          p_start_on: string
          p_todo_id: number
          p_todo_status: string
          p_todo_updated_at: string
        }
        Returns: number
      }
      update_project_milestone: {
        Args: {
          p_due_on: string
          p_milestone_id: number
          p_milestone_updated_at: string
          p_operation: string
          p_project_id: number
          p_project_updated_at: string
          p_title: string
        }
        Returns: number
      }
      update_recurring_expense_rule: {
        Args: {
          p_amount: number
          p_category: string
          p_end_date: string
          p_frequency: string
          p_id: number
          p_interval_count: number
          p_memo: string
          p_payer: string
          p_title: string
        }
        Returns: {
          active: boolean
          amount: number
          category: string
          created_at: string
          day_of_month: number
          end_date: string | null
          frequency: string
          id: number
          interval_count: number
          last_generated_at: string | null
          memo: string | null
          next_run_date: string
          payer: string | null
          source_expense_id: number | null
          start_date: string
          template_rule_id: number | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recurring_expenses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
