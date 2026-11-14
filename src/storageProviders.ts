export type StorageProviderStatus = 'active' | 'reserved';

export interface StorageProviderSlot {
  id: 'appwrite' | 'terabox' | 'icedrive';
  name: string;
  status: StorageProviderStatus;
  label: string;
  description: string;
}

/**
 * Storage-provider registry.
 * Appwrite remains the only configured storage backend.
 * TeraBox and Icedrive are intentionally reserved until official
 * developer credentials and supported APIs are supplied.
 */
export const storageProviders: StorageProviderSlot[] = [
  {
    id: 'appwrite',
    name: 'Appwrite Storage',
    status: 'active',
    label: 'Active',
    description: 'Current encrypted attachment storage. Existing MECHAT uploads continue to use this provider.',
  },
  {
    id: 'terabox',
    name: 'TeraBox',
    status: 'reserved',
    label: 'Reserved',
    description: 'Integration slot prepared. Waiting for approved TeraBox developer credentials.',
  },
  {
    id: 'icedrive',
    name: 'Icedrive',
    status: 'reserved',
    label: 'Reserved',
    description: 'Integration slot prepared. Waiting for an officially supported API and credentials.',
  },
];
