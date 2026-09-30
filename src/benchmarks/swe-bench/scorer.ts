import type { ScorerService } from "../../harness/scorer";
import { makeRewardScorer } from "../harbor/reward";
import { readSweBenchMeta } from "./dataset";

export const sweBenchScorer: ScorerService = makeRewardScorer(readSweBenchMeta);
