
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "alerts": {
                  Row: {
                    "body": string | null,"created_at": string,"data": NonNullable<Json>,"dedupe_key": string | null,"emailed_at": string | null,"id": string,"in_app": boolean,"is_demo": boolean,"read_at": string | null,"severity": Database["public"]['Enums']["alert_severity"],"title": string,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"in_app"?: boolean,"is_demo"?: boolean,"read_at"?: string | null,"severity"?: Database["public"]['Enums']["alert_severity"],"title": string,"type": string,"user_id": string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"in_app"?: boolean,"is_demo"?: boolean,"read_at"?: string | null,"severity"?: Database["public"]['Enums']["alert_severity"],"title"?: string,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"api_connection_secrets": {
                  Row: {
                    "ciphertext": string,"connection_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ciphertext": string,"connection_id": string,"updated_at"?: string
                  }
                  Update: {
                    "ciphertext"?: string,"connection_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_connection_secrets_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: true
      referencedRelation: "api_connections"
      referencedColumns: ["id"]
    }
                  ]
                },"api_connections": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"is_enabled": boolean,"key_last4": string | null,"label": string,"last_error": string | null,"last_odds_at": string | null,"last_odds_events": number | null,"last_success_at": string | null,"last_test_result": Json | null,"last_tested_at": string | null,"provider_id": string,"quota_remaining": number | null,"quota_used": number | null,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"key_last4"?: string | null,"label"?: string,"last_error"?: string | null,"last_odds_at"?: string | null,"last_odds_events"?: number | null,"last_success_at"?: string | null,"last_test_result"?: Json | null,"last_tested_at"?: string | null,"provider_id": string,"quota_remaining"?: number | null,"quota_used"?: number | null,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"key_last4"?: string | null,"label"?: string,"last_error"?: string | null,"last_odds_at"?: string | null,"last_odds_events"?: number | null,"last_success_at"?: string | null,"last_test_result"?: Json | null,"last_tested_at"?: string | null,"provider_id"?: string,"quota_remaining"?: number | null,"quota_used"?: number | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_connections_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "odds_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"api_request_logs": {
                  Row: {
                    "at": string,"cache_hit": boolean,"connection_id": string | null,"cost_units": number | null,"duration_ms": number | null,"endpoint": string,"error": string | null,"id": number,"provider_id": string,"quota_remaining": number | null,"status": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"cache_hit"?: boolean,"connection_id"?: string | null,"cost_units"?: number | null,"duration_ms"?: number | null,"endpoint": string,"error"?: string | null,"id"?: never,"provider_id": string,"quota_remaining"?: number | null,"status"?: number | null,"user_id"?: string | null
                  }
                  Update: {
                    "at"?: string,"cache_hit"?: boolean,"connection_id"?: string | null,"cost_units"?: number | null,"duration_ms"?: number | null,"endpoint"?: string,"error"?: string | null,"id"?: never,"provider_id"?: string,"quota_remaining"?: number | null,"status"?: number | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_request_logs_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "api_connections"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor": string,"after": Json | null,"at": string,"before": Json | null,"entity": string,"entity_id": string,"id": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity": string,"entity_id": string,"id"?: never,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string,"after"?: Json | null,"at"?: string,"before"?: Json | null,"entity"?: string,"entity_id"?: string,"id"?: never,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"bankroll_transactions": {
                  Row: {
                    "amount": number,"balance_after": number,"bankroll_id": string,"bet_id": string | null,"created_at": string,"fx_rate": number | null,"id": number,"is_demo": boolean,"note": string | null,"occurred_at": string,"original_amount": number | null,"original_currency": string | null,"settlement_seq": number | null,"trade_id": string | null,"transfer_group": string | null,"type": Database["public"]['Enums']["tx_type"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"balance_after": number,"bankroll_id": string,"bet_id"?: string | null,"created_at"?: string,"fx_rate"?: number | null,"id"?: never,"is_demo"?: boolean,"note"?: string | null,"occurred_at"?: string,"original_amount"?: number | null,"original_currency"?: string | null,"settlement_seq"?: number | null,"trade_id"?: string | null,"transfer_group"?: string | null,"type": Database["public"]['Enums']["tx_type"],"user_id": string
                  }
                  Update: {
                    "amount"?: number,"balance_after"?: number,"bankroll_id"?: string,"bet_id"?: string | null,"created_at"?: string,"fx_rate"?: number | null,"id"?: never,"is_demo"?: boolean,"note"?: string | null,"occurred_at"?: string,"original_amount"?: number | null,"original_currency"?: string | null,"settlement_seq"?: number | null,"trade_id"?: string | null,"transfer_group"?: string | null,"type"?: Database["public"]['Enums']["tx_type"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bankroll_transactions_bankroll_id_fkey"
      columns: ["bankroll_id"]
isOneToOne: false
      referencedRelation: "bankrolls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bankroll_transactions_bet_id_fkey"
      columns: ["bet_id"]
isOneToOne: false
      referencedRelation: "bets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bankroll_transactions_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"bankrolls": {
                  Row: {
                    "allow_negative": boolean,"archived": boolean,"balance": number,"created_at": string,"currency": string,"id": string,"is_demo": boolean,"kind": string,"name": string,"sport_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_negative"?: boolean,"archived"?: boolean,"balance"?: number,"created_at"?: string,"currency": string,"id"?: string,"is_demo"?: boolean,"kind"?: string,"name": string,"sport_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "allow_negative"?: boolean,"archived"?: boolean,"balance"?: number,"created_at"?: string,"currency"?: string,"id"?: string,"is_demo"?: boolean,"kind"?: string,"name"?: string,"sport_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bankrolls_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"bet_legs": {
                  Row: {
                    "bet_id": string,"closing_odds": number | null,"event_id": string | null,"event_name": string,"event_start": string | null,"id": string,"leg_no": number,"line": number | null,"market": string,"odds": number,"selection": string,"sport_id": string | null,"status": Database["public"]['Enums']["leg_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "bet_id": string,"closing_odds"?: number | null,"event_id"?: string | null,"event_name": string,"event_start"?: string | null,"id"?: string,"leg_no": number,"line"?: number | null,"market": string,"odds": number,"selection": string,"sport_id"?: string | null,"status"?: Database["public"]['Enums']["leg_status"]
                  }
                  Update: {
                    "bet_id"?: string,"closing_odds"?: number | null,"event_id"?: string | null,"event_name"?: string,"event_start"?: string | null,"id"?: string,"leg_no"?: number,"line"?: number | null,"market"?: string,"odds"?: number,"selection"?: string,"sport_id"?: string | null,"status"?: Database["public"]['Enums']["leg_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "bet_legs_bet_id_fkey"
      columns: ["bet_id"]
isOneToOne: false
      referencedRelation: "bets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bet_legs_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bet_legs_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"bet_notes": {
                  Row: {
                    "bet_id": string,"body": string,"created_at": string,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bet_id": string,"body": string,"created_at"?: string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "bet_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bet_notes_bet_id_fkey"
      columns: ["bet_id"]
isOneToOne: false
      referencedRelation: "bets"
      referencedColumns: ["id"]
    }
                  ]
                },"bets": {
                  Row: {
                    "actual_payout": number | null,"away": string | null,"bankroll_id": string,"bookmaker_id": string | null,"cashed_out_stake": number,"cashout_amount": number,"client_ref": string | null,"closing_captured_at": string | null,"closing_odds": number | null,"closing_source": string | null,"commission": number,"confidence": number | null,"correlation_group": string | null,"created_at": string,"currency": string,"deleted_at": string | null,"est_probability": number | null,"event_id": string | null,"event_name": string,"event_start": string | null,"fx_rate": number,"home": string | null,"id": string,"import_hash": string | null,"is_demo": boolean,"is_live": boolean,"kind": Database["public"]['Enums']["bet_kind"],"league_id": string | null,"liability": number,"line": number | null,"market": string,"market_category": string | null,"market_id": string | null,"market_type_id": string | null,"notes": string | null,"odds": number,"opening_odds": number | null,"placed_at": string,"potential_payout": number,"profit": number | null,"ref": number,"selection": string,"settle_count": number,"settled_at": string | null,"settled_cashout_amount": number,"settled_cashout_stake": number,"side": Database["public"]['Enums']["bet_side"],"sport_id": string,"stake": number,"status": Database["public"]['Enums']["bet_status"],"strategy_id": string | null,"tags": (string)[],"units": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_payout"?: number | null,"away"?: string | null,"bankroll_id": string,"bookmaker_id"?: string | null,"cashed_out_stake"?: number,"cashout_amount"?: number,"client_ref"?: string | null,"closing_captured_at"?: string | null,"closing_odds"?: number | null,"closing_source"?: string | null,"commission"?: number,"confidence"?: number | null,"correlation_group"?: string | null,"created_at"?: string,"currency": string,"deleted_at"?: string | null,"est_probability"?: number | null,"event_id"?: string | null,"event_name": string,"event_start"?: string | null,"fx_rate"?: number,"home"?: string | null,"id"?: string,"import_hash"?: string | null,"is_demo"?: boolean,"is_live"?: boolean,"kind"?: Database["public"]['Enums']["bet_kind"],"league_id"?: string | null,"liability": number,"line"?: number | null,"market": string,"market_category"?: string | null,"market_id"?: string | null,"market_type_id"?: string | null,"notes"?: string | null,"odds": number,"opening_odds"?: number | null,"placed_at"?: string,"potential_payout": number,"profit"?: number | null,"ref"?: never,"selection": string,"settle_count"?: number,"settled_at"?: string | null,"settled_cashout_amount"?: number,"settled_cashout_stake"?: number,"side"?: Database["public"]['Enums']["bet_side"],"sport_id": string,"stake": number,"status"?: Database["public"]['Enums']["bet_status"],"strategy_id"?: string | null,"tags"?: (string)[],"units"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "actual_payout"?: number | null,"away"?: string | null,"bankroll_id"?: string,"bookmaker_id"?: string | null,"cashed_out_stake"?: number,"cashout_amount"?: number,"client_ref"?: string | null,"closing_captured_at"?: string | null,"closing_odds"?: number | null,"closing_source"?: string | null,"commission"?: number,"confidence"?: number | null,"correlation_group"?: string | null,"created_at"?: string,"currency"?: string,"deleted_at"?: string | null,"est_probability"?: number | null,"event_id"?: string | null,"event_name"?: string,"event_start"?: string | null,"fx_rate"?: number,"home"?: string | null,"id"?: string,"import_hash"?: string | null,"is_demo"?: boolean,"is_live"?: boolean,"kind"?: Database["public"]['Enums']["bet_kind"],"league_id"?: string | null,"liability"?: number,"line"?: number | null,"market"?: string,"market_category"?: string | null,"market_id"?: string | null,"market_type_id"?: string | null,"notes"?: string | null,"odds"?: number,"opening_odds"?: number | null,"placed_at"?: string,"potential_payout"?: number,"profit"?: number | null,"ref"?: never,"selection"?: string,"settle_count"?: number,"settled_at"?: string | null,"settled_cashout_amount"?: number,"settled_cashout_stake"?: number,"side"?: Database["public"]['Enums']["bet_side"],"sport_id"?: string,"stake"?: number,"status"?: Database["public"]['Enums']["bet_status"],"strategy_id"?: string | null,"tags"?: (string)[],"units"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bets_bankroll_id_fkey"
      columns: ["bankroll_id"]
isOneToOne: false
      referencedRelation: "bankrolls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_league_id_fkey"
      columns: ["league_id"]
isOneToOne: false
      referencedRelation: "leagues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_market_type_id_fkey"
      columns: ["market_type_id"]
isOneToOne: false
      referencedRelation: "market_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bets_strategy_id_fkey"
      columns: ["strategy_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id"]
    }
                  ]
                },"bookmaker_accounts": {
                  Row: {
                    "bookmaker_id": string,"commission": number | null,"created_at": string,"currency": string,"id": string,"max_stake": number | null,"notes": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bookmaker_id": string,"commission"?: number | null,"created_at"?: string,"currency"?: string,"id"?: string,"max_stake"?: number | null,"notes"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "bookmaker_id"?: string,"commission"?: number | null,"created_at"?: string,"currency"?: string,"id"?: string,"max_stake"?: number | null,"notes"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookmaker_accounts_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    }
                  ]
                },"bookmakers": {
                  Row: {
                    "created_at": string,"default_commission": number,"id": string,"is_active": boolean,"is_exchange": boolean,"key": string,"name": string,"owner_id": string | null,"provider_keys": NonNullable<Json>,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"default_commission"?: number,"id"?: string,"is_active"?: boolean,"is_exchange"?: boolean,"key": string,"name": string,"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"website"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"default_commission"?: number,"id"?: string,"is_active"?: boolean,"is_exchange"?: boolean,"key"?: string,"name"?: string,"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"website"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"email_events": {
                  Row: {
                    "at": string,"detail": string | null,"http_status": number | null,"id": number,"outbox_id": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"detail"?: string | null,"http_status"?: number | null,"id"?: never,"outbox_id": string,"status": string,"user_id": string
                  }
                  Update: {
                    "at"?: string,"detail"?: string | null,"http_status"?: number | null,"id"?: never,"outbox_id"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_events_outbox_id_fkey"
      columns: ["outbox_id"]
isOneToOne: false
      referencedRelation: "email_outbox"
      referencedColumns: ["id"]
    }
                  ]
                },"email_outbox": {
                  Row: {
                    "alert_id": string | null,"alert_type": string | null,"attempts": number,"body": string | null,"created_at": string,"dedupe_key": string,"delivered_at": string | null,"id": string,"kind": string,"last_error": string | null,"max_attempts": number,"next_attempt_at": string,"provider": string | null,"provider_message_id": string | null,"sent_at": string | null,"status": string,"subject": string,"to_email": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_id"?: string | null,"alert_type"?: string | null,"attempts"?: number,"body"?: string | null,"created_at"?: string,"dedupe_key": string,"delivered_at"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"provider"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string,"subject": string,"to_email": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "alert_id"?: string | null,"alert_type"?: string | null,"attempts"?: number,"body"?: string | null,"created_at"?: string,"dedupe_key"?: string,"delivered_at"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"provider"?: string | null,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string,"subject"?: string,"to_email"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_outbox_alert_id_fkey"
      columns: ["alert_id"]
isOneToOne: false
      referencedRelation: "alerts"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "away": string | null,"created_at": string,"external_id": string | null,"home": string | null,"id": string,"is_demo": boolean,"last_synced_at": string | null,"league_id": string | null,"name": string,"owner_id": string | null,"provider": string | null,"score": Json | null,"sport_id": string,"start_time": string,"status": Database["public"]['Enums']["event_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "away"?: string | null,"created_at"?: string,"external_id"?: string | null,"home"?: string | null,"id"?: string,"is_demo"?: boolean,"last_synced_at"?: string | null,"league_id"?: string | null,"name": string,"owner_id"?: string | null,"provider"?: string | null,"score"?: Json | null,"sport_id": string,"start_time": string,"status"?: Database["public"]['Enums']["event_status"]
                  }
                  Update: {
                    "away"?: string | null,"created_at"?: string,"external_id"?: string | null,"home"?: string | null,"id"?: string,"is_demo"?: boolean,"last_synced_at"?: string | null,"league_id"?: string | null,"name"?: string,"owner_id"?: string | null,"provider"?: string | null,"score"?: Json | null,"sport_id"?: string,"start_time"?: string,"status"?: Database["public"]['Enums']["event_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_league_id_fkey"
      columns: ["league_id"]
isOneToOne: false
      referencedRelation: "leagues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"exchange_rates": {
                  Row: {
                    "as_of": string,"base": string,"created_at": string,"id": number,"owner_id": string | null,"quote": string,"rate": number,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of": string,"base": string,"created_at"?: string,"id"?: never,"owner_id"?: string | null,"quote": string,"rate": number,"source"?: string
                  }
                  Update: {
                    "as_of"?: string,"base"?: string,"created_at"?: string,"id"?: never,"owner_id"?: string | null,"quote"?: string,"rate"?: number,"source"?: string
                  }
                  Relationships: [
                    
                  ]
                },"goals": {
                  Row: {
                    "achieved_at": string | null,"bankroll_id": string | null,"created_at": string,"id": string,"is_demo": boolean,"metric": string,"name": string,"period_end": string,"period_start": string,"target": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved_at"?: string | null,"bankroll_id"?: string | null,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"metric": string,"name": string,"period_end": string,"period_start": string,"target": number,"user_id": string
                  }
                  Update: {
                    "achieved_at"?: string | null,"bankroll_id"?: string | null,"created_at"?: string,"id"?: string,"is_demo"?: boolean,"metric"?: string,"name"?: string,"period_end"?: string,"period_start"?: string,"target"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goals_bankroll_id_fkey"
      columns: ["bankroll_id"]
isOneToOne: false
      referencedRelation: "bankrolls"
      referencedColumns: ["id"]
    }
                  ]
                },"leagues": {
                  Row: {
                    "country": string | null,"created_at": string,"id": string,"is_active": boolean,"name": string,"owner_id": string | null,"provider_keys": NonNullable<Json>,"sport_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country"?: string | null,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"sport_id": string
                  }
                  Update: {
                    "country"?: string | null,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"sport_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leagues_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"market_types": {
                  Row: {
                    "category": string,"created_at": string,"has_line": boolean,"id": string,"is_active": boolean,"key": string,"name": string,"outcomes": (string)[],"owner_id": string | null,"provider_keys": NonNullable<Json>,"settlement": string,"sport_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"has_line"?: boolean,"id"?: string,"is_active"?: boolean,"key": string,"name": string,"outcomes"?: (string)[],"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"settlement"?: string,"sport_id"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"has_line"?: boolean,"id"?: string,"is_active"?: boolean,"key"?: string,"name"?: string,"outcomes"?: (string)[],"owner_id"?: string | null,"provider_keys"?: NonNullable<Json>,"settlement"?: string,"sport_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "market_types_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"markets": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"key": string,"line": number | null,"market_type_id": string | null,"name": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"key": string,"line"?: number | null,"market_type_id"?: string | null,"name": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"key"?: string,"line"?: number | null,"market_type_id"?: string | null,"name"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "markets_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "markets_market_type_id_fkey"
      columns: ["market_type_id"]
isOneToOne: false
      referencedRelation: "market_types"
      referencedColumns: ["id"]
    }
                  ]
                },"odds_providers": {
                  Row: {
                    "auth_scheme": string,"base_url": string,"default_rate_limit_per_minute": number,"docs_url": string | null,"id": string,"implemented": boolean,"kind": string,"min_refresh_seconds": number,"name": string,"notes": string | null,"supports_history": boolean,"supports_live": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_scheme": string,"base_url": string,"default_rate_limit_per_minute"?: number,"docs_url"?: string | null,"id": string,"implemented"?: boolean,"kind": string,"min_refresh_seconds"?: number,"name": string,"notes"?: string | null,"supports_history"?: boolean,"supports_live"?: boolean
                  }
                  Update: {
                    "auth_scheme"?: string,"base_url"?: string,"default_rate_limit_per_minute"?: number,"docs_url"?: string | null,"id"?: string,"implemented"?: boolean,"kind"?: string,"min_refresh_seconds"?: number,"name"?: string,"notes"?: string | null,"supports_history"?: boolean,"supports_live"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"odds_snapshots": {
                  Row: {
                    "bookmaker_id": string,"captured_at": string,"event_id": string,"id": number,"is_closing": boolean,"is_demo": boolean,"is_live": boolean,"line": number | null,"market_id": string,"odds": number,"owner_id": string | null,"provider": string,"provider_updated_at": string | null,"selection": string,"suspended": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "bookmaker_id": string,"captured_at"?: string,"event_id": string,"id"?: never,"is_closing"?: boolean,"is_demo"?: boolean,"is_live"?: boolean,"line"?: number | null,"market_id": string,"odds": number,"owner_id"?: string | null,"provider": string,"provider_updated_at"?: string | null,"selection": string,"suspended"?: boolean
                  }
                  Update: {
                    "bookmaker_id"?: string,"captured_at"?: string,"event_id"?: string,"id"?: never,"is_closing"?: boolean,"is_demo"?: boolean,"is_live"?: boolean,"line"?: number | null,"market_id"?: string,"odds"?: number,"owner_id"?: string | null,"provider"?: string,"provider_updated_at"?: string | null,"selection"?: string,"suspended"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "odds_snapshots_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    }
                  ]
                },"performance_snapshots": {
                  Row: {
                    "balance": number,"bankroll_id": string,"created_at": string,"cum_profit": number,"cum_staked": number,"drawdown_pct": number,"equity": number,"id": number,"is_demo": boolean,"net_deposits": number,"open_exposure": number,"peak_equity": number,"settled_bets": number,"snapshot_date": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "balance": number,"bankroll_id": string,"created_at"?: string,"cum_profit": number,"cum_staked": number,"drawdown_pct": number,"equity": number,"id"?: never,"is_demo"?: boolean,"net_deposits": number,"open_exposure": number,"peak_equity": number,"settled_bets": number,"snapshot_date": string,"user_id": string
                  }
                  Update: {
                    "balance"?: number,"bankroll_id"?: string,"created_at"?: string,"cum_profit"?: number,"cum_staked"?: number,"drawdown_pct"?: number,"equity"?: number,"id"?: never,"is_demo"?: boolean,"net_deposits"?: number,"open_exposure"?: number,"peak_equity"?: number,"settled_bets"?: number,"snapshot_date"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "performance_snapshots_bankroll_id_fkey"
      columns: ["bankroll_id"]
isOneToOne: false
      referencedRelation: "bankrolls"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "base_currency": string,"created_at": string,"display_name": string | null,"email": string | null,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_currency"?: string,"created_at"?: string,"display_name"?: string | null,"email"?: string | null,"id": string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "base_currency"?: string,"created_at"?: string,"display_name"?: string | null,"email"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"risk_limits": {
                  Row: {
                    "enforce": boolean,"is_demo": boolean,"max_bet_pct_bankroll": number | null,"max_correlated_exposure": number | null,"max_daily_loss": number | null,"max_drawdown_pct": number | null,"max_event_exposure": number | null,"max_stake_per_bet": number | null,"max_total_exposure_pct": number | null,"max_weekly_loss": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "enforce"?: boolean,"is_demo"?: boolean,"max_bet_pct_bankroll"?: number | null,"max_correlated_exposure"?: number | null,"max_daily_loss"?: number | null,"max_drawdown_pct"?: number | null,"max_event_exposure"?: number | null,"max_stake_per_bet"?: number | null,"max_total_exposure_pct"?: number | null,"max_weekly_loss"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "enforce"?: boolean,"is_demo"?: boolean,"max_bet_pct_bankroll"?: number | null,"max_correlated_exposure"?: number | null,"max_daily_loss"?: number | null,"max_drawdown_pct"?: number | null,"max_event_exposure"?: number | null,"max_stake_per_bet"?: number | null,"max_total_exposure_pct"?: number | null,"max_weekly_loss"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"saved_views": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"name": string,"scope": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config": NonNullable<Json>,"created_at"?: string,"id"?: string,"name": string,"scope"?: string,"user_id": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name"?: string,"scope"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sports": {
                  Row: {
                    "created_at": string,"has_draw": boolean,"id": string,"is_active": boolean,"key": string,"name": string,"owner_id": string | null,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"has_draw"?: boolean,"id"?: string,"is_active"?: boolean,"key": string,"name": string,"owner_id"?: string | null,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"has_draw"?: boolean,"id"?: string,"is_active"?: boolean,"key"?: string,"name"?: string,"owner_id"?: string | null,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"strategies": {
                  Row: {
                    "color": string,"created_at": string,"description": string | null,"entry_conditions": string | null,"est_probability": number | null,"id": string,"is_active": boolean,"is_demo": boolean,"market_type_id": string | null,"max_odds": number | null,"min_odds": number | null,"name": string,"sport_id": string | null,"stake_rule": NonNullable<Json>,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"description"?: string | null,"entry_conditions"?: string | null,"est_probability"?: number | null,"id"?: string,"is_active"?: boolean,"is_demo"?: boolean,"market_type_id"?: string | null,"max_odds"?: number | null,"min_odds"?: number | null,"name": string,"sport_id"?: string | null,"stake_rule"?: NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"description"?: string | null,"entry_conditions"?: string | null,"est_probability"?: number | null,"id"?: string,"is_active"?: boolean,"is_demo"?: boolean,"market_type_id"?: string | null,"max_odds"?: number | null,"min_odds"?: number | null,"name"?: string,"sport_id"?: string | null,"stake_rule"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategies_market_type_id_fkey"
      columns: ["market_type_id"]
isOneToOne: false
      referencedRelation: "market_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "strategies_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    }
                  ]
                },"trade_executions": {
                  Row: {
                    "amount": number | null,"executed_at": string,"id": string,"note": string | null,"odds": number | null,"side": Database["public"]['Enums']["execution_side"],"stake": number,"trade_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"executed_at"?: string,"id"?: string,"note"?: string | null,"odds"?: number | null,"side": Database["public"]['Enums']["execution_side"],"stake": number,"trade_id": string
                  }
                  Update: {
                    "amount"?: number | null,"executed_at"?: string,"id"?: string,"note"?: string | null,"odds"?: number | null,"side"?: Database["public"]['Enums']["execution_side"],"stake"?: number,"trade_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trade_executions_trade_id_fkey"
      columns: ["trade_id"]
isOneToOne: false
      referencedRelation: "trades"
      referencedColumns: ["id"]
    }
                  ]
                },"trades": {
                  Row: {
                    "bankroll_id": string,"bookmaker_id": string | null,"closed_at": string | null,"commission": number,"created_at": string,"currency": string,"event_id": string | null,"event_name": string,"fx_rate": number,"id": string,"is_demo": boolean,"is_live": boolean,"league_id": string | null,"market": string,"notes": string | null,"opened_at": string,"outcome": Database["public"]['Enums']["trade_outcome"] | null,"realized_partial": number,"realized_partial_base": number,"realized_pnl": number | null,"reserved": number,"reserved_base": number,"selection": string,"sport_id": string,"status": Database["public"]['Enums']["trade_status"],"strategy_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bankroll_id": string,"bookmaker_id"?: string | null,"closed_at"?: string | null,"commission"?: number,"created_at"?: string,"currency": string,"event_id"?: string | null,"event_name": string,"fx_rate"?: number,"id"?: string,"is_demo"?: boolean,"is_live"?: boolean,"league_id"?: string | null,"market": string,"notes"?: string | null,"opened_at"?: string,"outcome"?: Database["public"]['Enums']["trade_outcome"] | null,"realized_partial"?: number,"realized_partial_base"?: number,"realized_pnl"?: number | null,"reserved"?: number,"reserved_base"?: number,"selection": string,"sport_id": string,"status"?: Database["public"]['Enums']["trade_status"],"strategy_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "bankroll_id"?: string,"bookmaker_id"?: string | null,"closed_at"?: string | null,"commission"?: number,"created_at"?: string,"currency"?: string,"event_id"?: string | null,"event_name"?: string,"fx_rate"?: number,"id"?: string,"is_demo"?: boolean,"is_live"?: boolean,"league_id"?: string | null,"market"?: string,"notes"?: string | null,"opened_at"?: string,"outcome"?: Database["public"]['Enums']["trade_outcome"] | null,"realized_partial"?: number,"realized_partial_base"?: number,"realized_pnl"?: number | null,"reserved"?: number,"reserved_base"?: number,"selection"?: string,"sport_id"?: string,"status"?: Database["public"]['Enums']["trade_status"],"strategy_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trades_bankroll_id_fkey"
      columns: ["bankroll_id"]
isOneToOne: false
      referencedRelation: "bankrolls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_league_id_fkey"
      columns: ["league_id"]
isOneToOne: false
      referencedRelation: "leagues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_sport_id_fkey"
      columns: ["sport_id"]
isOneToOne: false
      referencedRelation: "sports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trades_strategy_id_fkey"
      columns: ["strategy_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id"]
    }
                  ]
                },"user_settings": {
                  Row: {
                    "alert_preferences": NonNullable<Json>,"annualization_days": number,"clv_convention": Database["public"]['Enums']["clv_convention"],"clv_reference_bookmaker": string | null,"dashboard_widgets": NonNullable<Json>,"date_basis": string,"default_bankroll_id": string | null,"default_kelly_fraction": number,"display_currency": string,"mode": Database["public"]['Enums']["workspace_mode"],"notification_email": string | null,"notification_prefs": NonNullable<Json>,"odds_format": string,"risk_free_rate": number,"sortino_mar": number,"theme": string,"timezone": string,"unit_size": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_preferences"?: NonNullable<Json>,"annualization_days"?: number,"clv_convention"?: Database["public"]['Enums']["clv_convention"],"clv_reference_bookmaker"?: string | null,"dashboard_widgets"?: NonNullable<Json>,"date_basis"?: string,"default_bankroll_id"?: string | null,"default_kelly_fraction"?: number,"display_currency"?: string,"mode"?: Database["public"]['Enums']["workspace_mode"],"notification_email"?: string | null,"notification_prefs"?: NonNullable<Json>,"odds_format"?: string,"risk_free_rate"?: number,"sortino_mar"?: number,"theme"?: string,"timezone"?: string,"unit_size"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "alert_preferences"?: NonNullable<Json>,"annualization_days"?: number,"clv_convention"?: Database["public"]['Enums']["clv_convention"],"clv_reference_bookmaker"?: string | null,"dashboard_widgets"?: NonNullable<Json>,"date_basis"?: string,"default_bankroll_id"?: string | null,"default_kelly_fraction"?: number,"display_currency"?: string,"mode"?: Database["public"]['Enums']["workspace_mode"],"notification_email"?: string | null,"notification_prefs"?: NonNullable<Json>,"odds_format"?: string,"risk_free_rate"?: number,"sortino_mar"?: number,"theme"?: string,"timezone"?: string,"unit_size"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_settings_clv_ref_fk"
      columns: ["clv_reference_bookmaker"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "odds_latest": {
                  Row: {
                    "bookmaker_id": string,"captured_at": string,"event_id": string,"id": number,"is_closing": boolean,"is_demo": boolean,"is_live": boolean,"line": number | null,"market_id": string,"odds": number,"owner_id": string | null,"provider": string,"provider_updated_at": string | null,"selection": string,"suspended": boolean
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "odds_snapshots_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    }
                  ]
                },"odds_opening": {
                  Row: {
                    "bookmaker_id": string,"captured_at": string,"event_id": string,"id": number,"is_closing": boolean,"is_demo": boolean,"is_live": boolean,"line": number | null,"market_id": string,"odds": number,"owner_id": string | null,"provider": string,"provider_updated_at": string | null,"selection": string,"suspended": boolean
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "odds_snapshots_bookmaker_id_fkey"
      columns: ["bookmaker_id"]
isOneToOne: false
      referencedRelation: "bookmakers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "odds_snapshots_market_id_fkey"
      columns: ["market_id"]
isOneToOne: false
      referencedRelation: "markets"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "add_bet_note":
{ Args: { "p_bet": string,"p_body": string }; Returns: {
              "bet_id": string,
"body": string,
"created_at": string,
"id": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bet_notes"
        isOneToOne: true
        isSetofReturn: false
      } },
"add_trade_execution":
{ Args: { "p_amount"?: number,"p_executed_at"?: string,"p_note"?: string,"p_odds": number,"p_side": Database["public"]['Enums']["execution_side"],"p_stake": number,"p_trade": string }; Returns: {
              "amount": number | null,
"executed_at": string,
"id": string,
"note": string | null,
"odds": number | null,
"side": Database["public"]['Enums']["execution_side"],
"stake": number,
"trade_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "trade_executions"
        isOneToOne: true
        isSetofReturn: false
      } },
"bulk_settle":
{ Args: { "p_bets": (string)[],"p_status": Database["public"]['Enums']["bet_status"] }; Returns: number
                           },
"bulk_update_bets":
{ Args: { "p": Json,"p_bets": (string)[] }; Returns: number
                           },
"capture_closing_odds":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"capture_closing_odds_for":
{ Args: { "p_user": string }; Returns: number
                           },
"claim_email_batch":
{ Args: { "p_limit"?: number,"p_only"?: string }; Returns: {
              "alert_id": string | null,
"alert_type": string | null,
"attempts": number,
"body": string | null,
"created_at": string,
"dedupe_key": string,
"delivered_at": string | null,
"id": string,
"kind": string,
"last_error": string | null,
"max_attempts": number,
"next_attempt_at": string,
"provider": string | null,
"provider_message_id": string | null,
"sent_at": string | null,
"status": string,
"subject": string,
"to_email": string,
"updated_at": string,
"user_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "email_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"clear_demo_data":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"create_bankroll":
{ Args: { "p_allow_negative"?: boolean,"p_currency": string,"p_kind"?: string,"p_name": string,"p_opening_deposit"?: number,"p_sport"?: string }; Returns: {
              "allow_negative": boolean,
"archived": boolean,
"balance": number,
"created_at": string,
"currency": string,
"id": string,
"is_demo": boolean,
"kind": string,
"name": string,
"sport_id": string | null,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bankrolls"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_bet":
{ Args: { "p_bet": string }; Returns: undefined
                           },
"import_bets":
{ Args: { "p_bankroll": string,"p_rows": Json,"p_skip_duplicates"?: boolean }; Returns: Json
                           },
"latest_snapshots":
{ Args: { "p_markets": (string)[] }; Returns: {
              "bookmaker_id": string,"captured_at": string,"line": number,"market_id": string,"odds": number,"selection": string,"suspended": boolean
            }[]
                           },
"mark_closing_odds":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"open_trade":
{ Args: { "p": Json }; Returns: {
              "bankroll_id": string,
"bookmaker_id": string | null,
"closed_at": string | null,
"commission": number,
"created_at": string,
"currency": string,
"event_id": string | null,
"event_name": string,
"fx_rate": number,
"id": string,
"is_demo": boolean,
"is_live": boolean,
"league_id": string | null,
"market": string,
"notes": string | null,
"opened_at": string,
"outcome": Database["public"]['Enums']["trade_outcome"] | null,
"realized_partial": number,
"realized_partial_base": number,
"realized_pnl": number | null,
"reserved": number,
"reserved_base": number,
"selection": string,
"sport_id": string,
"status": Database["public"]['Enums']["trade_status"],
"strategy_id": string | null,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "trades"
        isOneToOne: true
        isSetofReturn: false
      } },
"partial_cashout":
{ Args: { "p_amount": number,"p_bet": string,"p_stake_portion": number }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"place_bet":
{ Args: { "p": Json }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"prune_odds_history":
{ Args: { "p_days"?: number }; Returns: number
                           },
"queue_test_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"record_transaction":
{ Args: { "p_amount": number,"p_bankroll": string,"p_note"?: string,"p_occurred_at"?: string,"p_type": Database["public"]['Enums']["tx_type"] }; Returns: {
              "amount": number,
"balance_after": number,
"bankroll_id": string,
"bet_id": string | null,
"created_at": string,
"fx_rate": number | null,
"id": number,
"is_demo": boolean,
"note": string | null,
"occurred_at": string,
"original_amount": number | null,
"original_currency": string | null,
"settlement_seq": number | null,
"trade_id": string | null,
"transfer_group": string | null,
"type": Database["public"]['Enums']["tx_type"],
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bankroll_transactions"
        isOneToOne: true
        isSetofReturn: false
      } },
"refresh_performance_snapshots":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"reopen_bet":
{ Args: { "p_bet": string }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"reset_demo_data":
{ Args: { "p": Json }; Returns: Json
                           },
"set_leg_results":
{ Args: { "p_bet": string,"p_legs": Json }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_workspace_mode":
{ Args: { "p_mode": Database["public"]['Enums']["workspace_mode"] }; Returns: Database["public"]['Enums']["workspace_mode"]
                           },
"settle_bet":
{ Args: { "p_bet": string,"p_cashout_amount"?: number,"p_closing_odds"?: number,"p_legs"?: Json,"p_settled_at"?: string,"p_status"?: Database["public"]['Enums']["bet_status"] }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"settle_trade":
{ Args: { "p_closed_at"?: string,"p_outcome": Database["public"]['Enums']["trade_outcome"],"p_trade": string }; Returns: {
              "bankroll_id": string,
"bookmaker_id": string | null,
"closed_at": string | null,
"commission": number,
"created_at": string,
"currency": string,
"event_id": string | null,
"event_name": string,
"fx_rate": number,
"id": string,
"is_demo": boolean,
"is_live": boolean,
"league_id": string | null,
"market": string,
"notes": string | null,
"opened_at": string,
"outcome": Database["public"]['Enums']["trade_outcome"] | null,
"realized_partial": number,
"realized_partial_base": number,
"realized_pnl": number | null,
"reserved": number,
"reserved_base": number,
"selection": string,
"sport_id": string,
"status": Database["public"]['Enums']["trade_status"],
"strategy_id": string | null,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "trades"
        isOneToOne: true
        isSetofReturn: false
      } },
"transfer_funds":
{ Args: { "p_amount": number,"p_from": string,"p_fx_rate"?: number,"p_note"?: string,"p_to": string }; Returns: string
                           },
"update_bet":
{ Args: { "p": Json,"p_bet": string }; Returns: {
              "actual_payout": number | null,
"away": string | null,
"bankroll_id": string,
"bookmaker_id": string | null,
"cashed_out_stake": number,
"cashout_amount": number,
"client_ref": string | null,
"closing_captured_at": string | null,
"closing_odds": number | null,
"closing_source": string | null,
"commission": number,
"confidence": number | null,
"correlation_group": string | null,
"created_at": string,
"currency": string,
"deleted_at": string | null,
"est_probability": number | null,
"event_id": string | null,
"event_name": string,
"event_start": string | null,
"fx_rate": number,
"home": string | null,
"id": string,
"import_hash": string | null,
"is_demo": boolean,
"is_live": boolean,
"kind": Database["public"]['Enums']["bet_kind"],
"league_id": string | null,
"liability": number,
"line": number | null,
"market": string,
"market_category": string | null,
"market_id": string | null,
"market_type_id": string | null,
"notes": string | null,
"odds": number,
"opening_odds": number | null,
"placed_at": string,
"potential_payout": number,
"profit": number | null,
"ref": number,
"selection": string,
"settle_count": number,
"settled_at": string | null,
"settled_cashout_amount": number,
"settled_cashout_stake": number,
"side": Database["public"]['Enums']["bet_side"],
"sport_id": string,
"stake": number,
"status": Database["public"]['Enums']["bet_status"],
"strategy_id": string | null,
"tags": (string)[],
"units": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "bets"
        isOneToOne: true
        isSetofReturn: false
      } },
"verify_bankroll":
{ Args: { "p_bankroll": string }; Returns: Json
                           }
          }
          Enums: {
            "alert_severity": "info"|"warning"|"critical","app_role": "user"|"admin","bet_kind": "single"|"accumulator","bet_side": "back"|"lay","bet_status": "pending"|"won"|"lost"|"void"|"half_won"|"half_lost"|"cashed_out"|"partial_win"|"partial_loss"|"break_even","clv_convention": "odds"|"probability","event_status": "scheduled"|"live"|"finished"|"postponed"|"cancelled"|"suspended"|"unknown","execution_side": "back"|"lay"|"cashout","leg_status": "pending"|"won"|"lost"|"void"|"half_won"|"half_lost","trade_outcome": "win"|"lose"|"void","trade_status": "open"|"settled"|"void","tx_type": "deposit"|"withdrawal"|"bet_placement"|"bet_settlement"|"cashout"|"bet_reversal"|"transfer_in"|"transfer_out"|"adjustment"|"trade_settlement"|"trade_reservation"|"trade_cashout","workspace_mode": "live"|"demo"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "alert_severity": ["info", "warning", "critical"],"app_role": ["user", "admin"],"bet_kind": ["single", "accumulator"],"bet_side": ["back", "lay"],"bet_status": ["pending", "won", "lost", "void", "half_won", "half_lost", "cashed_out", "partial_win", "partial_loss", "break_even"],"clv_convention": ["odds", "probability"],"event_status": ["scheduled", "live", "finished", "postponed", "cancelled", "suspended", "unknown"],"execution_side": ["back", "lay", "cashout"],"leg_status": ["pending", "won", "lost", "void", "half_won", "half_lost"],"trade_outcome": ["win", "lose", "void"],"trade_status": ["open", "settled", "void"],"tx_type": ["deposit", "withdrawal", "bet_placement", "bet_settlement", "cashout", "bet_reversal", "transfer_in", "transfer_out", "adjustment", "trade_settlement", "trade_reservation", "trade_cashout"],"workspace_mode": ["live", "demo"]
          }
        }
} as const
