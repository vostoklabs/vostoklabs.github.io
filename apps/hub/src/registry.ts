// Generator & seller-tool registry types, matching generators.json schema.

export interface Generator {
  id: string;
  name: string;
  route: 'mw' | 'app' | 'both';
  status: 'live' | 'coming-soon';
  blurb: string;
  mwUrl?: string;
  appUrl?: string;
  external?: boolean;
  /** Thumbnail filename (looked up in /thumbs/<id>.webp). */
  thumb?: string;
}

export interface SellerTool {
  id: string;
  name: string;
  status: 'live' | 'coming-soon';
  blurb: string;
  appUrl?: string;
}

export interface Registry {
  generators: Generator[];
  sellerTools: SellerTool[];
}
