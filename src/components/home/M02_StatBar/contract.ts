export type StatCounts = {
  modules: number;
  pipelines: number;
  community: number;
  assetKeys: number;
};

export type StatBarProps = {
  counts: StatCounts;
  labels: {
    modules: string;
    pipelines: string;
    community: string;
    assetKeys: string;
  };
};
