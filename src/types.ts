export type PostRef = {
  id: string;
  title: string;
  slug: string;
  status: string;
  updated_at: string;
  url?: string;
  published_at?: string;
  custom_excerpt?: string;
  tags: string[];
};

export type FailedItem = {
  id?: string;
  title?: string;
  error: string;
};

export type DeployResult = {
  accepted: boolean;
  host: string;
  status: number;
};

export type BatchResult = {
  succeeded: PostRef[];
  failed: FailedItem[];
  partial_failure: boolean;
  deploy?: DeployResult;
};

export type ImageAsset = {
  url: string;
  mime_type: string;
  bytes: number;
  source: 'upload' | 'openai';
  model?: string;
  request_id?: string;
};

export type DraftInput = {
  title: string;
  markdown: string;
  slug?: string;
  tags?: string[];
  excerpt?: string;
  featured?: boolean;
  feature_image_url?: string;
  feature_image_alt?: string;
  feature_image_caption?: string;
  meta_title?: string;
  meta_description?: string;
  canonical_url?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  twitter_title?: string;
  twitter_description?: string;
  twitter_image?: string;
};
