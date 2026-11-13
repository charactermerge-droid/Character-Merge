/**
 * Azure Blob Storage with user-delegation SAS (Entra ID), per spec §4.4.
 * The service principal needs "Storage Blob Data Reader" on the storage account.
 * Azure SDK modules are imported lazily so local mode never loads them.
 */
export async function createAzureStorage(cfg) {
  const [{ DefaultAzureCredential }, blobSdk] = await Promise.all([
    import('@azure/identity'),
    import('@azure/storage-blob'),
  ]);
  const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol } = blobSdk;

  const account = cfg.azureStorageAccount;
  const origin = `https://${account}.blob.core.windows.net`;
  const blobService = new BlobServiceClient(origin, new DefaultAzureCredential());

  let delegationKey = null;
  let delegationExpiry = 0;
  let keyInflight = null;

  // Cached: fetching a delegation key per request adds latency and hits rate limits.
  async function getDelegationKey() {
    const now = Date.now();
    if (delegationKey && now < delegationExpiry - 5 * 60 * 1000) return delegationKey;
    if (keyInflight) return keyInflight;
    keyInflight = (async () => {
      const start = new Date(now - 5 * 60 * 1000);      // clock-skew allowance
      const end = new Date(now + 6 * 60 * 60 * 1000);   // 6h; refreshed well before
      const key = await blobService.getUserDelegationKey(start, end);
      delegationKey = key;
      delegationExpiry = end.getTime();
      return key;
    })();
    try { return await keyInflight; } finally { keyInflight = null; }
  }

  return {
    kind: 'azure',
    describe: () => origin,

    async signBlob(container, blobName) {
      const key = await getDelegationKey();
      const now = Date.now();
      const expiresOn = new Date(now + cfg.sasTtlMinutes * 60 * 1000);
      const sas = generateBlobSASQueryParameters({
        containerName: container,
        blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(now - 5 * 60 * 1000),
        expiresOn,
        protocol: SASProtocol.Https,
      }, key, account).toString();
      return {
        url: `${origin}/${container}/${encodeURIComponent(blobName)}?${sas}`,
        expiresAt: expiresOn.toISOString(),
      };
    },

    async getBlobProps(container, blobName) {
      const props = await blobService.getContainerClient(container).getBlobClient(blobName).getProperties();
      return { etag: props.etag, contentLength: props.contentLength };
    },

    async listBlobs(container) {
      const names = new Set();
      for await (const b of blobService.getContainerClient(container).listBlobsFlat()) names.add(b.name);
      return names;
    },
  };
}
