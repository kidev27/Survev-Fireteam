import { eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Config } from "../../config.ts";
import { isMongo } from "../db/dialect.ts";
import { db, getMongoDb } from "../db/index.ts";
import { mongoStore } from "../db/mongoStore.ts";
import { sessionTable, type SessionTableSelect, usersTable, type UsersTableSelect } from "../db/schema.ts";

export const sessionCookieName = "auth_session";

function toSha256(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
    token: string,
    userId: string,
): Promise<SessionTableSelect> {
    const sessionId = toSha256(token);

    const session: SessionTableSelect = {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    };
    if (isMongo()) {
        await mongoStore.insertSession(session);
    } else {
        await db.insert(sessionTable).values(session);
    }
    return session;
}

export async function validateSessionToken(
    token: string,
): Promise<SessionValidationResult> {
    if (!Config.database.enabled) return { session: null, user: null };

    const sessionId = toSha256(token);

    if (isMongo()) {
        const session = await mongoStore.findSession(sessionId);
        if (!session) return { session: null, user: null };
        const expiresAt = session.expiresAt instanceof Date
            ? session.expiresAt
            : new Date(String(session.expiresAt));
        if (Date.now() >= expiresAt.getTime()) {
            await mongoStore.deleteSession(sessionId);
            return { session: null, user: null };
        }
        const user = await mongoStore.findUserById(String(session.userId));
        if (!user) return { session: null, user: null };
        const sessionRow: SessionTableSelect = {
            id: String(session.id),
            userId: String(session.userId),
            expiresAt,
        };
        if (Date.now() >= expiresAt.getTime() - 1000 * 60 * 60 * 24 * 15) {
            sessionRow.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
            await getMongoDb().collection("session").updateOne(
                { id: sessionId },
                { $set: { expiresAt: sessionRow.expiresAt } },
            );
        }
        return { session: sessionRow, user };
    }

    const result = await db
        .select({ user: usersTable, session: sessionTable })
        .from(sessionTable)
        .innerJoin(usersTable, eq(sessionTable.userId, usersTable.id))
        .where(eq(sessionTable.id, sessionId));
    if (result.length < 1) {
        return { session: null, user: null };
    }
    const { user, session } = result[0];
    if (Date.now() >= session.expiresAt.getTime()) {
        await db.delete(sessionTable).where(eq(sessionTable.id, session.id));
        return { session: null, user: null };
    }
    if (Date.now() >= session.expiresAt.getTime() - 1000 * 60 * 60 * 24 * 15) {
        session.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
        await db
            .update(sessionTable)
            .set({
                expiresAt: session.expiresAt,
            })
            .where(eq(sessionTable.id, session.id));
    }
    return { session, user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
    if (isMongo()) {
        await mongoStore.deleteSession(sessionId);
        return;
    }
    await db.delete(sessionTable).where(eq(sessionTable.id, sessionId));
}

export async function invalidateAllSessions(userId: string): Promise<void> {
    if (isMongo()) {
        await mongoStore.deleteSessionsForUser(userId);
        return;
    }
    await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
}

export async function deleteExpiredSessions(): Promise<void> {
    if (isMongo()) {
        await mongoStore.deleteExpiredSessions();
        return;
    }
    await db.delete(sessionTable).where(lt(sessionTable.expiresAt, new Date()));
}

export type SessionValidationResult =
    | { session: SessionTableSelect; user: UsersTableSelect }
    | { session: null; user: null };
