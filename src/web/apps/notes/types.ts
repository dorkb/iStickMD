export const COLORS = [
  "yellow",
  "pink",
  "blue",
  "green",
  "purple",
  "orange",
  "gray",
] as const;

export type Color = (typeof COLORS)[number];

export type Note = {
  id: string;
  title: string;
  color: Color;
  order: number;
  height: number;
  content: string;
  preview: string;
  updated: string;
};

export type Notebook = {
  slug: string;
  title: string;
  color: Color;
  order: number;
};

export type User = {
  name: string;
  displayName: string;
  color: string;
  order: number;
};
