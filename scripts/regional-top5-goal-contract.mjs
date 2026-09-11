"use strict";

import assert from "node:assert/strict";
import { evaluateRegionalRows } from "./regional-top5-goal-audit.mjs";

const report = evaluateRegionalRows([
  {
    group: "district",
    name: "Kadıköy",
    slug: "kadikoy-escort",
    status: "has_gsc_data",
    avg_position: 4.2,
    impressions: 12,
    top_page: "https://vip-gece.site/kadikoy-escort"
  },
  {
    group: "district",
    name: "Şişli",
    slug: "sisli-escort",
    status: "has_gsc_data",
    avg_position: 3,
    impressions: 20,
    top_page: "https://vip-gece.site/profil/ornek-sisli"
  },
  {
    group: "district",
    name: "Beyoğlu",
    slug: "beyoglu-escort",
    status: "has_gsc_data",
    avg_position: 8,
    impressions: 15,
    top_page: "https://vip-gece.site/beyoglu-escort"
  },
  {
    group: "district",
    name: "Adalar",
    slug: "adalar-escort",
    status: "no_gsc_data",
    avg_position: "",
    impressions: 0,
    top_page: ""
  },
  {
    group: "istanbul",
    name: "İstanbul",
    slug: "istanbul-escort",
    status: "has_gsc_data",
    avg_position: 4,
    impressions: 2,
    top_page: "https://vip-gece.site/istanbul-escort"
  }
], { minimumImpressions: 10 });

assert.deepEqual(report.summary.districts, {
  total: 4,
  with_data: 3,
  correct_target_page: 2,
  top5_validated: 1,
  top5_low_sample: 0,
  outside_top5: 1,
  cannibalized: 1,
  no_data: 1
});
assert.equal(report.summary.istanbul_hub.top5_low_sample, 1);
assert.equal(report.rows.find((row) => row.name === "Şişli")?.goal_status, "cannibalized");

console.log("PASS regional top5 goal evaluation contract");
