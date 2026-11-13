export type PlatformStatus = 'active';
export interface PlatformProviderSlot { id: 'appwrite' | 'netlify'; name: string; role: string; status: PlatformStatus; label: string; description: string; }
export const platformProviders: PlatformProviderSlot[] = [
 { id:'appwrite', name:'Appwrite TablesDB', role:'Primary database', status:'active', label:'Active', description:'Encrypted message envelopes, contacts, groups, delivery receipts and call signalling.' },
 { id:'netlify', name:'Netlify Functions', role:'API backend', status:'active', label:'Active', description:'Server-side API routes hosted alongside the MECHAT web app.' }
];
