"use server";

import { prisma } from "@/lib/prisma";

export async function createExpense(data: {
  category: string;
  title: string;
  amount: number;
  currency?: string;
  description?: string;
  date?: Date;
  project?: string;
}) {
  const expense = await prisma.budgetExpense.create({ data });

  // Award points for using budget
  try {
    const { awardPoints } = await import("./achievements");
    await awardPoints("manager", "Menedżer", "💰", "Dodaj pierwszy wpis do budżetu", 15);
  } catch {}

  return expense;
}

export async function getExpenses(options?: {
  category?: string;
  project?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  return prisma.budgetExpense.findMany({
    where: {
      ...(options?.category && { category: options.category }),
      ...(options?.project && { project: options.project }),
      ...(options?.startDate && { date: { gte: options.startDate } }),
      ...(options?.endDate && { date: { lte: options.endDate } }),
    },
    orderBy: { date: "desc" },
  });
}

export async function deleteExpense(id: string) {
  return prisma.budgetExpense.delete({ where: { id } });
}

export async function getBudgetSummary() {
  const expenses = await prisma.budgetExpense.findMany();
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  const byProject = expenses.reduce((acc, e) => {
    if (e.project) {
      acc[e.project] = (acc[e.project] || 0) + e.amount;
    }
    return acc;
  }, {} as Record<string, number>);

  return { total, byCategory, byProject, count: expenses.length };
}

/**
 * „Budżet w pigułce” — expenses of the CURRENT calendar month (DB-primary).
 * Used by the dashboard tile; month boundaries are computed server-side so the
 * client can't drift across timezones.
 */
export async function getMonthlyBudgetSummary() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const expenses = await prisma.budgetExpense.findMany({
    where: { date: { gte: startOfMonth, lt: startOfNextMonth } },
    orderBy: { date: "desc" },
  });

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  return {
    total,
    count: expenses.length,
    byCategory,
    latest: expenses[0] ?? null,
  };
}
