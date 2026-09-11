"use strict";

import { DETAIL_STATE } from "./state.js?v=20260726-seotitle1";
import {
  fetchDetailProfile,
  fetchPublicProfiles,
  currentSlug,
  matchProfile,
  profileImages
} from "./utils.js?v=20260726-seotitle1";
import {
  renderDetailFallback,
  renderMissingProfile,
  renderPrimaryDetail
} from "./view.js?v=20260729-conversion1";
import { startProfileAnalytics } from "./analytics.js?v=20260728-proof2";

async function loadClientFallback(slug) {
  try {
    const [profile, profiles] = await Promise.all([
      fetchDetailProfile(slug),
      fetchPublicProfiles().catch(() => [])
    ]);

    if (!profile || !matchProfile(profile, slug)) {
      renderMissingProfile();
      return;
    }

    DETAIL_STATE.profile = profile;
    DETAIL_STATE.images = profileImages(profile);
    DETAIL_STATE.profiles = profiles;

    renderDetailFallback(profile, profiles);
    startProfileAnalytics(slug);
  } catch (error) {
    console.warn(error);
    renderMissingProfile();
  }
}

function initializeDetail() {
  const runtime = document.body?.dataset || {};

  if (runtime.serverRendered === "true") {
    const slug = runtime.profileSlug || currentSlug();
    if (runtime.profilePreview === "true") {
      try {
        const preview = JSON.parse(
          document.getElementById("vipProfilePreviewData")?.textContent || "null"
        );
        if (preview) {
          DETAIL_STATE.profile = preview;
          DETAIL_STATE.images = profileImages(preview);
          DETAIL_STATE.profiles = [];
          renderPrimaryDetail(preview);
        }
      } catch (error) {
        console.warn("Profil önizlemesi başlatılamadı:", error);
      }
      return;
    }
    startProfileAnalytics(slug);
    void fetchDetailProfile(slug)
      .then((profile) => {
        if (!profile) return;
        DETAIL_STATE.profile = profile;
        DETAIL_STATE.images = profileImages(profile);
        renderPrimaryDetail(profile);
      })
      .catch((error) => console.warn("Profil etkileşimleri başlatılamadı:", error));
    return;
  }

  void loadClientFallback(currentSlug());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeDetail, { once: true });
} else {
  initializeDetail();
}
