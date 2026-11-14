export type PlatformStatus = 'primary';
export interface PlatformProviderSlot { id: 'appwrite' | 'netlify'; name: string; role: string; status: PlatformStatus; label: string; description: string; }
export const platformProviders: PlatformProviderSlot[] = [
 {id:'appwrite',name:'Appwrite',role:'Primary database & media storage',status:'primary',label:'Primary',description:'MECHAT messages, profiles, encrypted attachments and call signalling are stored through Appwrite.'},
 {id:'netlify',name:'Netlify Functions',role:'Backend API hosting',status:'primary',label:'Primary',description:'Server-side API endpoints validate Firebase ID tokens and access Appwrite using a server-only API key.'}
];
