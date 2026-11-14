/** Lets features navigate and refresh without importing main.ts (avoids circular imports). */
export const bus = {
    navigate: (_href: string): void => undefined,
    refresh: async (): Promise<void> => undefined,
};
