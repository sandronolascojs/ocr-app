import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { generateRandomTeamName } from "./utils";
import { eq } from "drizzle-orm";

export const createDefaultTeamForUser = async (userId: string) => {
  // Check if user already has a team
  const existingTeam = await db.query.teams.findFirst({
    where: eq(teams.ownerId, userId),
  });

  if (existingTeam) {
    return existingTeam;
  }

  // Create new team with random name
  const teamName = generateRandomTeamName();
  const [team] = await db
    .insert(teams)
    .values({
      name: teamName,
      ownerId: userId,
    })
    .returning();

  // Add user as owner member
  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: userId,
    role: "owner",
  });

  return team;
};

