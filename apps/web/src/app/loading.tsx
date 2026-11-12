import { Buck } from "@/components/buck/Buck";

/**
 * The instant loading state for every route below the root layout: Buck, fetching the page.
 * Layouts stay interactive while a page streams in, so this only replaces the content area,
 * and the words are there for screen readers and for Reduce motion, where Buck holds still.
 */
export default function Loading() {
  return (
    <div className="buck-loader" role="status">
      <Buck mood="loading" size={88} />
      <span>Loading</span>
    </div>
  );
}
