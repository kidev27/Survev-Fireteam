import { Config } from "../../config.ts";
import * as mysqlSchema from "./schema.mysql.ts";
import * as pgSchema from "./schema.pg.ts";

const useMysql = Config.database.engine === "mariadb";
const s = (useMysql ? mysqlSchema : pgSchema) as typeof pgSchema;

export const sessionTable = s.sessionTable;
export const usersTable = s.usersTable;
export const itemsTable = s.itemsTable;
export const userPassTable = s.userPassTable;
export const userQuestTable = s.userQuestTable;
export const matchDataTable = s.matchDataTable;
export const ipLogsTable = s.ipLogsTable;
export const bannedIpsTable = s.bannedIpsTable;

export type SessionTableSelect = pgSchema.SessionTableSelect;
export type UsersTableInsert = pgSchema.UsersTableInsert;
export type UsersTableSelect = pgSchema.UsersTableSelect;
export type UserPassTableSelect = pgSchema.UserPassTableSelect;
export type UserQuestTableSelect = pgSchema.UserQuestTableSelect;
export type MatchDataTable = pgSchema.MatchDataTable;
export type IpLogsTable = pgSchema.IpLogsTable;
