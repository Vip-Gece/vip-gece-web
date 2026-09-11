"use strict";

const { renderHomeHtml } = require("./render/homeRenderer");
const { renderListingsHubHtml, renderCategoriesHubHtml, renderContactHtml } = require("./render/hubRenderers");
const { renderProfileDetailHtml } = require("./render/detailRenderer");
const { renderCategoryHtml } = require("./render/landingRenderer");
const { renderStaticPublicHtml } = require("./render/shared");

module.exports = {
  renderCategoriesHubHtml,
  renderCategoryHtml,
  renderContactHtml,
  renderHomeHtml,
  renderListingsHubHtml,
  renderProfileDetailHtml,
  renderStaticPublicHtml
};
