export type StorageProviderStatus = 'active' | 'legacy' | 'reserved';

export interface StorageProviderSlot {
  id: 'supabase' | 'appwrite' | 'terabox' | 'icedrive';
  name: string;
  status: StorageProviderStatus;
  label: string;
  description: string;
}

export const storageProviders: StorageProviderSlot[] = [
  {
    id: 'supabase',
    name: 'Supabase Storage',
    status: 'active',
    label: 'Active',
    description: 'Private encrypted media bucket with short-lived signed uploads and downloads.',
  },
  {
    id: 'appwrite',
    name: 'Appwrite Storage',
    status: 'legacy',
    label: 'Legacy archive',
    description: 'Previous MECHAT storage retained as a migration source; new uploads no longer use it.',
  },
  {
    id: 'terabox',
    name: 'TeraBox',
    status: 'reserved',
    label: 'Not connected',
    description: 'No supported official developer integration is configured.',
  },
  {
    id: 'icedrive',
    name: 'Icedrive',
    status: 'reserved',
    label: 'Not connected',
    description: 'No supported official developer integration is configured.',
  },
];
