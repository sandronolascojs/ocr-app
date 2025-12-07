import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../init";
import { teams, teamMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createDefaultTeamForUser } from "@/lib/teams/createDefaultTeam";
import { TRPCError } from "@trpc/server";

export const teamsRouter = createTRPCRouter({
  getMyTeam: protectedProcedure.query(async ({ ctx }) => {
    // Get or create default team for user
    const team = await createDefaultTeamForUser(ctx.userId);

    // Get team with members
    const teamWithMembers = await ctx.db.query.teams.findFirst({
      where: eq(teams.id, team.id),
      with: {
        members: {
          with: {
            user: true,
          },
        },
        owner: true,
      },
    });

    return teamWithMembers;
  }),

  getTeamMembers: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const membership = await ctx.db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, ctx.userId)
        ),
      });

      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not a member of this team" });
      }

      const members = await ctx.db.query.teamMembers.findMany({
        where: eq(teamMembers.teamId, input.teamId),
        with: {
          user: true,
        },
      });

      return members;
    }),
});

