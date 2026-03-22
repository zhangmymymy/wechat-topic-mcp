// src/shared/types.ts

// ── Database Models ──

export interface Group {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  rowid?: number;
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  media_url: string | null;
  msg_type: "text" | "voice" | "image" | "link" | "file";
  is_transcribed: boolean;
  timestamp: string;
  source?: "ilink" | "local_db";
}

export interface Subscription {
  id: string;
  keyword: string;
  match_mode: "exact" | "fuzzy" | "regex";
  groups: string[] | null;
  notify_channels: ("telegram" | "slack")[];
  auto_push: boolean;
  schedule_cron: string | null;
  threshold: number | null;
  threshold_window: number | null;
  enabled: boolean;
  created_at: string;
}

export interface MessageTopicLink {
  message_id: string;
  subscription_id: string;
  anchor_id: string;
  relevance: number;
  method: "direct" | "context" | "semantic";
}

export interface Report {
  id: string;
  subscription_id: string | null;
  keyword: string;
  group_id: string | null;
  time_from: string;
  time_to: string;
  summary: string;
  sentiment: SentimentResult;
  key_opinions: KeyOpinion[];
  disputes: Dispute[];
  action_items: ActionItem[];
  trends: TrendMetrics;
  full_report: string;
  created_at: string;
}

// ── Analysis Types ──

export interface SentimentResult {
  positive: number;
  neutral: number;
  negative: number;
}

export interface KeyOpinion {
  sender: string;
  opinion: string;
  stance: "positive" | "neutral" | "negative";
}

export interface Dispute {
  topic: string;
  sides: { who: string; position: string }[];
}

export interface ActionItem {
  item: string;
  assignee: string | null;
  deadline: string | null;
}

export interface TrendMetrics {
  message_count: number;
  participant_count: number;
  density_per_hour: number;
  duration_minutes: number;
}

export interface AnalysisResult {
  related_message_ids: string[];
  report: {
    summary: string;
    sentiment: SentimentResult;
    key_opinions: KeyOpinion[];
    disputes: Dispute[];
    action_items: ActionItem[];
    trends: TrendMetrics;
  };
}

// ── Config Types ──

export interface AppConfig {
  sync: {
    wechat_data_dir: string;
    decrypt_output_dir: string;
    keys_file: string;
    scripts_dir?: string;
    cron: string;
  };
  ilink?: {
    enabled: boolean;
  };
  database: {
    type: "sqlite" | "postgres";
    path: string;
    url?: string;
  };
  ai: {
    provider: "openai" | "claude" | "ollama";
    api_key: string;
    base_url?: string;
    model: string;
    max_context_messages: number;
  };
  notify: {
    telegram: {
      bot_token: string;
      chat_id: string;
    };
    slack: {
      bot_token: string;
      channel: string;
    };
  };
  analysis: {
    context_before: number;
    context_after: number;
    cooldown_minutes: number;
  };
  retention: {
    messages_days: number;
    reports_days: number;
    cleanup_cron: string;
  };
  mcp: {
    port: number;
  };
}

// ── AI Provider Interface ──

export interface AIProvider {
  analyze(messages: Message[], keyword: string): Promise<AnalysisResult>;
  mergeReports(reports: AnalysisResult[], keyword: string): Promise<AnalysisResult>;
}

// ── Notifier Interface ──

export interface Notifier {
  send(report: Report, groupName: string): Promise<void>;
}

// ── Time Range ──

export interface TimeRange {
  from: string;
  to: string;
}
