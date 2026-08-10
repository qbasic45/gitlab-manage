function isLongLived(member, now) {
    if (!member.expires_at) return true;
    const oneYearLater = new Date(now);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    return new Date(member.expires_at) > oneYearLater;
}

function classifyMember(member, now) {
    if (!member.expires_at) return 'permanent';
    return isLongLived(member, now) ? 'long-term' : 'active';
}

module.exports = { isLongLived, classifyMember };
