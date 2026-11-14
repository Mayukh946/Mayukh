export type PlatformStatus = 'active' | 'pending' | 'legacy';
export interface PlatformProviderSlot { id: 'supabase' | 'netlify' | 'railway' | 'appwrite'; name: string; role: string; status: PlatformStatus; label: string; description: string; }
export const platformProviders: PlatformProviderSlot[] = [
  { id:'supabase', name:'Supabase', role:'Primary backend platform', status:'active', label:'Active', description:'PostgreSQL, authenticated Edge API, private storage and realtime notifications.' },
  { id:'netlify', name:'Netlify', role:'Frontend and PWA hosting', status:'active', label:'Active', description:'Hosts the MECHAT web app; production cutover waits for migration and QA.' },
  { id:'railway', name:'Railway', role:'Optional compute', status:'pending', label:'Not deployed', description:'Reserved for a separately justified worker or relay; not on the live request path yet.' },
  { id:'appwrite', name:'Appwrite', role:'Legacy migration source', status:'legacy', label:'Legacy', description:'Previous database and media remain preserved for data migration.' }
];
