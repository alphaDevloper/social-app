"use server";

import prisma from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function syncUser() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!user || !userId) return;

    const existingUser = await prisma.user.findUnique({
      where: {
        clerkId: userId,
      },
    });

    if (existingUser) return existingUser;

    const dbUser = await prisma.user.create({
      data: {
        clerkId: userId,
        name: `${user.firstName || ""} ${user.lastName || ""}`,
        username:
          user.username ?? user.emailAddresses[0].emailAddress.split("@")[0],
        email: user.emailAddresses[0].emailAddress,
        image: user.imageUrl,
      },
    });

    return dbUser;
  } catch (error) {}
}

// this action creates a new user in DB if there is no user in DB

export async function getUserByClerkId(clerkId: string) {
  return prisma.user.findUnique({
    where: {
      clerkId,
    },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          posts: true,
        },
      },
    },
  });
}

export async function getDbUserId() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    console.log("Clerk ID is null");
    return null;
  }
  const user = await getUserByClerkId(clerkId);
  if (!user) console.log("User not found");

  return user ? user.id : null;
}

export async function getRandomUsers() {
  try {
    const userId = await getDbUserId();

    if (!userId) {
      console.log("User ID is null or undefined");
      return [];
    }

    const randomUsers = await prisma.user.findMany({
      where: {
        AND: [
          {
            NOT: { id: userId }, // not including the current user
          },
          {
            NOT: {
              // not including the users that the current user follows
              followers: {
                some: {
                  followerId: userId, //current user is following these users
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        username: true,
        image: true,
        _count: {
          select: {
            followers: true,
          },
        },
      },
      take: 3,
    });
    return randomUsers;
  } catch (error) {
    console.log("Error fetching random Users");
  }
}

export async function toggleFollow(targetUserId: string) {
  try {
    const userId = await getDbUserId();

    if (!userId) throw new Error("User ID is null or undefined");
    if (userId === targetUserId) throw new Error("You can't follow yourself");

    const existingFollow = await prisma.follows.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId: targetUserId,
        },
      },
    });
    if (existingFollow) {
      // unfollow user
      await prisma.follows.delete({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: targetUserId,
          },
        },
      });
    } else {
      await prisma.$transaction([
        // create a follower and notification at the same time, both will succeed or fail together
        // this is a transaction, if one fails, both will fail
        prisma.follows.create({
          data: {
            followerId: userId,
            followingId: targetUserId,
          },
        }),
        prisma.notification.create({
          data: {
            type: "FOLLOW",
            userId: targetUserId, // user being followed
            creatorId: userId, // user who followed
          },
        }),
      ]);
      revalidatePath("/");
      return { success: true };
    }
  } catch (error) {
    console.log("Error toggling user");
  }
}
