"use strict";

const OWNER_ROLE = "full_admin";
const OPERATIONS_MANAGER_ROLE = "profile_admin";

function isOwnerRole(role) {
  return role === OWNER_ROLE;
}

function isOperationsRole(role) {
  return role === OWNER_ROLE || role === OPERATIONS_MANAGER_ROLE;
}

function adminPermissions(role = OWNER_ROLE) {
  const owner = isOwnerRole(role);
  const operations = isOperationsRole(role);

  return {
    role,
    roleLabel: owner ? "owner" : operations ? "operations_manager" : "unauthorized",
    canViewDashboard: operations,
    canViewProfiles: operations,
    canViewSettings: owner,
    canViewAds: operations,
    canViewSeo: owner,
    canViewAnalytics: operations,
    canManageProfiles: operations,
    canCreateProfile: operations,
    canEditAllProfiles: operations,
    canEditOwnProfiles: operations,
    canDeleteAllProfiles: operations,
    canDeleteOwnProfiles: operations,
    canManageSettings: owner,
    canManageAds: operations,
    canManageCustomers: owner,
    canRunGoogleSync: owner,
    canManageProfileSeo: owner,
    canManageSeo: owner,
    canManageInfrastructure: owner,
    canManageSiteIdentity: owner,
    readOnlyGlobalPanels: !owner
  };
}

module.exports = {
  OPERATIONS_MANAGER_ROLE,
  OWNER_ROLE,
  adminPermissions,
  isOperationsRole,
  isOwnerRole
};
