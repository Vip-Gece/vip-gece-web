import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  applyProfileCreateDefaults,
  assertActiveProfilePublishable,
  assertProfileUpdatePublishable,
  firstFreeSlot,
  isProfilePublishable,
  profilePublicationMissingFields
} = require("../src/services/profileDefaults");
const {
  filterApprovedPostgresProfiles,
  filterIndexableProfiles,
  filterPublicPostgresProfiles,
  listProfilePublicationPostgresProfiles
} = require("../src/data/postgresProfilesRepo");
const {
  indexableProfilesWithUsableImages,
  profileWithUsableImages,
  publicProfilesWithUsableImages
} = require("../src/data/profilesRepo");
const { getDemoProfiles } = require("../src/data/demoProfiles");

const failures = [];
let assertionCount = 0;
const strict = process.argv.includes("--strict");
const expectedProfileCount = Number.parseInt(
  process.env.VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT || "27",
  10
);

function assert(condition, message) {
  assertionCount += 1;
  if (condition) {
    console.log(`ok ${message}`);
    return;
  }

  failures.push(message);
  console.log(`fail ${message}`);
}

function throwsNotPublishable(callback, fields = []) {
  try {
    callback();
    return false;
  } catch (error) {
    return error?.code === "PROFILE_NOT_PUBLISHABLE" &&
      fields.every((field) => error.missing_fields?.includes(field));
  }
}

const completeProfile = {
  name: "Ada",
  slug: "ada",
  description: "Eksiksiz profil açıklaması.",
  images: ["/logo.png.webp"]
};

const draft = applyProfileCreateDefaults({ name: "Taslak" }, []);
assert(draft.is_active === false, "new profile defaults to inactive");

const completeDraft = applyProfileCreateDefaults(completeProfile, []);
assert(completeDraft.is_active === false, "complete profile still requires explicit owner publication");

const published = applyProfileCreateDefaults({ ...completeProfile, is_active: true }, []);
assert(published.is_active === true, "explicit complete profile can be published");

assert(
  firstFreeSlot([
    { type: "vip", vip_slot: 1, is_active: true },
    { type: "vip", vip_slot: 2, is_active: false },
    { type: "vip", vip_slot: 67, is_active: false }
  ], "vip") === 2,
  "inactive and draft profiles never reserve a live homepage slot"
);

assert(
  throwsNotPublishable(
    () => applyProfileCreateDefaults({ name: "Eksik", is_active: true }, []),
    ["slug", "description", "images"]
  ),
  "incomplete create cannot activate"
);

assert(
  throwsNotPublishable(
    () => assertProfileUpdatePublishable({ ...completeProfile, is_active: true }, { images: [] }),
    ["images"]
  ),
  "merged update cannot remove the last image from an active profile"
);

assert(
  throwsNotPublishable(
    () => assertActiveProfilePublishable({ ...completeProfile, images: ["http://cdn.example.com/insecure.jpg"], is_active: true }),
    ["images"]
  ),
  "insecure HTTP images cannot make a profile public"
);

assert(
  throwsNotPublishable(
    () => assertProfileUpdatePublishable({ ...completeProfile, is_active: false }, {
      is_active: true,
      description: " "
    }),
    ["description"]
  ),
  "activation validates the merged stored row"
);

assert(
  assertProfileUpdatePublishable(
    { ...completeProfile, is_active: false },
    { is_active: true }
  ).is_active === true,
  "complete inactive row can be explicitly activated"
);

assert(
  profilePublicationMissingFields({
    name: " ",
    slug: "\n",
    description: "",
    images: [" "]
    }).join(",") === "name,slug,description,images" &&
    isProfilePublishable(completeProfile) &&
    throwsNotPublishable(
      () => assertActiveProfilePublishable({ ...completeProfile, images: [], is_active: true }),
      ["images"]
    ),
  "publication policy requires nonblank text and one nonblank image"
);

const publicRows = filterPublicPostgresProfiles([
  { id: "visible", ...completeProfile, is_active: true },
  { id: "inactive", ...completeProfile, is_active: false },
  { id: "no-name", ...completeProfile, name: " ", is_active: true },
  { id: "no-image", ...completeProfile, images: [], is_active: true }
]);
assert(
  publicRows.length === 1 && publicRows[0].id === "visible",
  "public Postgres rows fail closed unless active and publishable"
);

const approvedRows = filterApprovedPostgresProfiles([
  { id: "approved-without-media", ...completeProfile, slug: "istanbul-sofia", images: [], is_active: true },
  { id: "inactive-allowlisted", ...completeProfile, slug: "istanbul-sofia", images: [], is_active: false }
]);
assert(
  approvedRows.length === 1 &&
    approvedRows[0].id === "approved-without-media" &&
    indexableProfilesWithUsableImages(approvedRows).length === 0,
  "approved rows without media remain excluded from indexable surfaces"
);

const indexableRows = filterIndexableProfiles([
  { id: "visible", ...completeProfile, is_active: true },
  {
    id: "seo-only",
    ...completeProfile,
    slug: "istanbul-sofia",
    images: [],
    is_active: true
  },
  {
    id: "inactive-allowlisted",
    ...completeProfile,
    slug: "istanbul-lara",
    images: [],
    is_active: false
  },
  {
    id: "private-draft",
    ...completeProfile,
    slug: "customer-private-draft",
    images: [],
    is_active: false
  }
]);
assert(
  indexableRows.length === 1 &&
    indexableRows.some((profile) => profile.id === "visible") &&
    !indexableRows.some((profile) => profile.id === "seo-only") &&
    !indexableRows.some((profile) => profile.id === "inactive-allowlisted") &&
    !indexableRows.some((profile) => profile.id === "private-draft"),
  "only active publishable profiles can be indexed"
);

const usableRows = publicProfilesWithUsableImages([
  {
    id: "missing-upload",
    ...completeProfile,
    images: ["/media/customer-upload/contracts/does-not-exist.webp"],
    is_active: true
  },
  { id: "usable", ...completeProfile, is_active: true }
]);
assert(
  usableRows.length === 1 && usableRows[0].id === "usable",
  "public rows fail closed after missing local images are removed"
);

const retiredImageProfile = profileWithUsableImages({
  images: [
    "https://hofblpqaxzhybozavtaz.supabase.co/storage/v1/object/public/images/vip-gece/profiles/migrated/missing.jpg",
    "/logo.png.webp"
  ]
});
assert(
  retiredImageProfile.images.length === 1 &&
    retiredImageProfile.images[0] === "/logo.png.webp",
  "retired remote image hosts are removed before public rendering"
);

const retiredOnlyImageProfile = profileWithUsableImages({
  images: [
    "https://hofblpqaxzhybozavtaz.supabase.co/storage/v1/object/public/images/vip-gece/profiles/migrated/missing.jpg"
  ]
});
assert(
  retiredOnlyImageProfile.images.length === 0,
  "profiles with only retired images remain without media and cannot be public"
);

const indexableUsableRows = indexableProfilesWithUsableImages([
  {
    id: "seo-only-missing-image",
    ...completeProfile,
    slug: "istanbul-sofia",
    images: ["/media/customer-upload/contracts/does-not-exist.webp"],
    is_active: true
  }
]);
assert(
  indexableUsableRows.length === 0,
  "missing-media profiles stay off public and indexable surfaces"
);

assert(
  publicProfilesWithUsableImages(getDemoProfiles()).length === 3,
  "explicit local demo profiles satisfy the same public publication policy"
);

const [adminSource, mobileSource, postgresSource, profilesSource, customerSource, healthSource] = await Promise.all([
  readFile(new URL("../src/routes/adminRoutes.js", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/adminMobileRoutes.js", import.meta.url), "utf8"),
  readFile(new URL("../src/data/postgresProfilesRepo.js", import.meta.url), "utf8"),
  readFile(new URL("../src/data/profilesRepo.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/customerAccessService.js", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/healthRoutes.js", import.meta.url), "utf8")
]);

assert(
  adminSource.includes("delete payload.is_active;") &&
    mobileSource.includes("delete payload.is_active;") &&
    mobileSource.includes(
      'router.post("/api/admin/mobile/profiles/:id/status", fullAdminAuth'
    ),
  "only full admin can request profile publication"
);

assert(
  postgresSource.includes("limit 1 for update") &&
    postgresSource.includes("assertProfileUpdatePublishable(current, nextPayload)") &&
    postgresSource.includes("assertOwnerProfileQuota") &&
    postgresSource.includes("options.ownerProfileLimit") &&
    postgresSource.includes("current.is_active !== true && nextPayload.is_active === true") &&
    postgresSource.includes("firstFreeSlot(existing.rows, profileType)") &&
    postgresSource.includes("const publicRows = filterPublicPostgresProfiles(rows)") &&
    postgresSource.includes("rows: publicRows"),
  "Postgres update and public fetch integrate publication checks"
);

assert(
  profilesSource.includes("return publicProfilesWithUsableImages(fallbackProfiles())"),
  "demo fallback uses the same public publication policy"
);

assert(
  customerSource.includes("return updatePostgresProfile(profileId, updatePayload)") &&
    customerSource.includes("assertProfileUpdatePublishable(currentProfile, updatePayload)"),
  "customer panel updates cannot bypass merged-row validation"
);

assert(
  healthSource.includes('require("../data/profilesRepo")') &&
    healthSource.includes("if (!profiles.length)") &&
    healthSource.includes('client.query("select 1")') &&
    healthSource.includes("assertCustomerProfileImageStorageReady") &&
    healthSource.includes("ensureProfileAnalyticsStorage"),
  "readiness verifies database, analytics, image storage and the filtered public profile surface"
);

let inventory = null;
if (strict) {
  const expectedTotalCount = Number.parseInt(process.env.VIP_GECE_EXPECTED_TOTAL_PROFILE_COUNT || String(expectedProfileCount), 10);
  assert(
    Number.isSafeInteger(expectedProfileCount) && expectedProfileCount > 0,
    "production inventory expectation is a positive integer"
  );
  const rows = await listProfilePublicationPostgresProfiles();
  const publicProfiles = publicProfilesWithUsableImages(rows);
  const indexableProfiles = indexableProfilesWithUsableImages(rows);
  inventory = {
    database_rows: rows.length,
    public: publicProfiles.length,
    seo_only: indexableProfiles.length - publicProfiles.length,
    indexable: indexableProfiles.length,
    ignored_drafts: rows.length - indexableProfiles.length
  };
  assert(
    inventory.database_rows === expectedTotalCount &&
      inventory.public === expectedProfileCount &&
      inventory.seo_only === 0 &&
      inventory.indexable === expectedProfileCount &&
      inventory.ignored_drafts === expectedTotalCount - expectedProfileCount,
    `production inventory preserves ${expectedTotalCount} total records with ${expectedProfileCount} public and indexable profiles`
  );
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  assertions: assertionCount,
  ...(inventory ? { inventory } : {})
}, null, 2));
