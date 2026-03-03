/**
 * In-memory store for production metadata.
 * Replace with DynamoDB or your DB of choice for persistence.
 */

export interface ProductionMetadata {
  productionUuid: string;
  sourceS3Key: string;
  outputS3Key?: string;
  status: 'pending' | 'done' | 'error';
  createdAt: string;
  updatedAt: string;
}

const store = new Map<string, ProductionMetadata>();

export const saveProduction = (metadata: ProductionMetadata): void => {
  const now = new Date().toISOString();
  const existing = store.get(metadata.productionUuid);
  store.set(metadata.productionUuid, {
    ...metadata,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  });
};

export const getProduction = (
  productionUuid: string
): ProductionMetadata | undefined => {
  return store.get(productionUuid);
};

export const getProductionBySourceKey = (
  sourceS3Key: string
): ProductionMetadata | undefined => {
  return [...store.values()].find((p) => p.sourceS3Key === sourceS3Key);
};

export const updateProduction = (
  productionUuid: string,
  updates: Partial<Omit<ProductionMetadata, 'productionUuid' | 'createdAt'>>
): void => {
  const existing = store.get(productionUuid);
  if (existing) {
    store.set(productionUuid, {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }
};
