export type ShelfTier = "official" | "community" | "experimental";

export type ShelfProps = {
  tier: ShelfTier;
  title: string;
  note: string;
  slots: number;
};
