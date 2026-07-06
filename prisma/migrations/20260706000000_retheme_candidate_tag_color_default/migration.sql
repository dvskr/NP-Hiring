-- Re-skin (teal -> deep berry): the default candidate-tag chip color moves
-- from the inherited teal primary (#0D9488) to the berry primary (#BE185D).
-- Existing rows keep whatever color the employer picked; only the column
-- default for newly created tags changes.
ALTER TABLE "candidate_tags" ALTER COLUMN "color" SET DEFAULT '#BE185D';
