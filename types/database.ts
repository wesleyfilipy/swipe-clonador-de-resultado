export type AdRow = {
  id: string;
  title: string;
  niche: string;
  video_url: string | null;
  vsl_url: string | null;
  thumbnail: string | null;
  ad_copy: string | null;
  views_day: number;
  views_week: number;
  active_days: number;
  facebook_ad_id: string | null;
  ad_library_id?: string | null;
  start_date?: string | null;
  score?: number | null;
  status?: string | null;
  last_seen_at?: string | null;
  page_name?: string | null;
  landing_domain?: string | null;
  appearance_count?: number | null;
  domain_frequency?: number | null;
  landing_ok?: boolean | null;
  vsl_html_path?: string | null;
  video_storage_path?: string | null;
  thumbnail_storage_path?: string | null;
  /** Catálogo centralizado (Apify / spy weekly). */
  country?: string | null;
  creative_url?: string | null;
  duplicate_count?: number | null;
  is_scaled?: boolean | null;
  is_winner?: boolean | null;
  trending?: boolean | null;
  spy_ingest_batch?: string | null;
  mine_source?: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscriptionRow = {
  id: string;
  ad_id: string;
  type: "creative" | "vsl";
  text: string;
  created_at: string;
};

export type SubscriptionRow = {
  id: string;
  user_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
};

export type SortMode = "scaled" | "recent" | "active" | "score";
