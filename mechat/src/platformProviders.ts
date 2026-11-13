export type PlatformStatus = 'active' | 'pending';
export interface PlatformProviderSlot { id: 'appwrite' | 'netlify'; name: string; role: string; status: PlatformStatus; label: string; description: string; }
export const platformProviders: PlatformProviderSlot[] = [
 { id:'appwrite', name:'Appwrite TablesDB', role:'Primary database', status:'active', label:'Active', description:'Encrypted message envelopes, contacts, groups, delivery receipts and call signalling.' },
 { id:'netlify', name:'Netlify Functions', role:'API backend', status:'pending', label:'Pending deployment', description:'API routes have been ported; connect the GitHub branch and configure server secrets to activate them.' }
];
