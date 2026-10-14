function isWorkspaceVisibleToUser(workspace, userId) {
  const memberIds = Array.isArray(workspace.memberIds) ? workspace.memberIds : null;

  if (workspace.tenantId === workspace.ownerId) {
    return workspace.ownerId === userId;
  }

  if (memberIds && memberIds.length === 1 && memberIds[0] === workspace.ownerId) {
    return workspace.ownerId === userId;
  }

  if (!memberIds || memberIds.length === 0) return true;

  return memberIds.includes(userId);
}

function sortWorkspacesForUser(items, userId) {
  return [...items].sort((a, b) => {
    const aIsPersonal = a.ownerId === userId && a.tenantId === userId;
    const bIsPersonal = b.ownerId === userId && b.tenantId === userId;

    if (aIsPersonal !== bIsPersonal) {
      return aIsPersonal ? -1 : 1;
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

module.exports = {
  isWorkspaceVisibleToUser,
  sortWorkspacesForUser,
};
