import type { ConceptLink } from "../loadConcepts";

export type PathsProps = {
  heading: string;
  aiHeading: string;
  humanHeading: string;
  pathAi: string[];
  pathHuman: string[];
  links: ConceptLink[];
};
