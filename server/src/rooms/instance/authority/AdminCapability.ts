import User from "../../../models/User";

export async function hasGameAdminCapability(userId: string): Promise<boolean> {
    if (!userId) return false;
    try {
        const user = await User.findById(userId).select("permissions");
        if (!user || !Array.isArray((user as any).permissions)) return false;
        return (user as any).permissions.includes("game.admin");
    } catch (error) {
        console.error("[Authority] Failed admin capability check:", error);
        return false;
    }
}
