// Article I — feed pagination + show-more behavior config.
//
// On any feed page we render up to PAGE_SIZE posts. The first INITIAL_VISIBLE
// are shown; the rest are hidden with `is-hidden` and revealed on "Show more"
// click in batches of SHOW_MORE_STEP. Once all locally-rendered cards are
// visible, the button swaps to "Older posts →" linking to the next paginated
// page (if one exists).

export const PAGE_SIZE = 50;
export const INITIAL_VISIBLE = 10;
export const SHOW_MORE_STEP = 10;

export function paginate<T>(items: T[], pageNum: number): { page: T[]; total: number; hasNext: boolean } {
  const start = (pageNum - 1) * PAGE_SIZE;
  const page = items.slice(start, start + PAGE_SIZE);
  return {
    page,
    total: items.length,
    hasNext: start + PAGE_SIZE < items.length,
  };
}
