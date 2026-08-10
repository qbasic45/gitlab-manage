function computeNewExpiry(currentExpiry, days) {
    if (!currentExpiry) throw new Error('currentExpiry is required');
    const date = new Date(currentExpiry);
    if (isNaN(date.getTime())) throw new Error(`Invalid date: ${currentExpiry}`);
    date.setDate(date.getDate() + days);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function groupItemsByResource(items) {
    const map = new Map();
    for (const item of items) {
        const key = `${item.resource_type}:${item.resource_id}`;
        if (!map.has(key)) {
            map.set(key, { resource_type: item.resource_type, resource_id: item.resource_id, items: [] });
        }
        map.get(key).items.push(item);
    }
    return Array.from(map.values());
}

function buildExtendChanges(items, days) {
    return items.map(item => ({
        action: 'update',
        user_id: item.user_id,
        username: item.username,
        access_level: item.access_level,
        expires_at: computeNewExpiry(item.expires_at, days),
    }));
}

module.exports = { computeNewExpiry, groupItemsByResource, buildExtendChanges };
