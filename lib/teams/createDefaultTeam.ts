import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { generateRandomTeamName } from "./utils";
import { eq } from "drizzle-orm";
import { TeamRole } from "@/types/enums/teamRole.enum";

export const createDefaultTeamForUser = async (userId: string) => {
  // Atomically insert or get existing team using upsert with conflict handling
  // This prevents race conditions where concurrent calls both try to insert
  const teamName = generateRandomTeamName();
  const [insertedTeam] = await db
    .insert(teams)
    .values({
      name: teamName,
      ownerId: userId,
    })
    .onConflictDoNothing({
      target: teams.ownerId,
    })
    .returning();

  // If insert returned nothing, the team already exists (conflict occurred)
  // Query for the existing team
  const team = insertedTeam
    ? insertedTeam
    : await db.query.teams.findFirst({
        where: eq(teams.ownerId, userId),
      });

  if (!team) {
    // This should never happen, but handle it defensively
    throw new Error("Failed to create or retrieve team for user");
  }

  // Add user as owner member (with conflict handling to prevent duplicates)
  // The unique constraint on (teamId, userId) will prevent duplicate memberships
  await db
    .insert(teamMembers)
    .values({
      teamId: team.id,
      userId: userId,
      role: TeamRole.OWNER,
    })
    .onConflictDoNothing({
      target: [teamMembers.teamId, teamMembers.userId],
    });

  return team;
};

