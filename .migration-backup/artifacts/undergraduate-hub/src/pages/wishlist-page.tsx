import { Heart, LoaderCircle, Search, Trash2 } from "lucide-react";
import { getListWishlistQueryKey, useListWishlist, useRemoveWishlist } from "@workspace/api-client-react";
import type { Book } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

const statusLabels: Record<string, string> = {
  available: "Available",
  rented: "Rented",
  lost: "Lost",
};

export function WishlistPage() {
  const query = useListWishlist();
  const remove = useRemoveWishlist();
  const queryClient = useQueryClient();
  const books = query.data ?? [];

  const removeBook = (book: Book) => {
    remove.mutate(
      { bookId: book.id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWishlistQueryKey() }) },
    );
  };

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-foreground">Your saved shelf</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Wishlist</h1>
          <p className="mt-2 text-sm text-muted-foreground">Keep a list of books you want to read next.</p>
        </div>
        <Link href="/books" className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5">
          <Search size={16} /> Find a book
        </Link>
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-sm text-muted-foreground" role="status">
          <LoaderCircle size={18} className="animate-spin" /> Loading your wishlist
        </div>
      ) : query.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="font-bold">Your wishlist could not be loaded.</p>
          <button type="button" className="mt-3 font-bold underline" onClick={() => query.refetch()}>Try again</button>
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/70 px-6 py-16 text-center">
          <Heart size={24} className="mx-auto text-accent-foreground" />
          <h2 className="mt-4 font-display text-xl font-bold">আপনার Wishlist এখনো খালি।</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Browse the catalogue and save a book here to find it again later.</p>
          <Link href="/books" className="mt-5 inline-flex rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-muted">Browse books</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <article key={book.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <Link href={`/books/${book.id}`} className="grid grid-cols-[104px_1fr] gap-4 p-4">
                <div className="relative flex min-h-36 items-end overflow-hidden rounded-xl bg-primary p-3">
                  {book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />}
                  <span className="relative line-clamp-4 font-serif text-sm font-bold leading-snug text-primary-foreground drop-shadow">{book.title}</span>
                </div>
                <div className="min-w-0 py-1">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${book.status === "available" ? "bg-emerald-50 text-emerald-800" : book.status === "rented" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800"}`}>
                    {statusLabels[book.status] ?? book.status}
                  </span>
                  <h2 className="mt-3 line-clamp-2 font-display font-bold leading-snug">{book.title}</h2>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{book.author}</p>
                  <p className="mt-3 text-[11px] font-semibold text-accent-foreground">{book.category} · {book.language}</p>
                  <p className="mt-2 text-xs font-bold">{book.depositRequired ? `Deposit ৳${book.depositAmount}` : "No deposit"}</p>
                </div>
              </Link>
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Link href={`/books/${book.id}`} className="text-xs font-bold text-accent-foreground hover:underline">View details</Link>
                <button
                  type="button"
                  onClick={() => removeBook(book)}
                  disabled={remove.isPending}
                  aria-label={`Remove ${book.title} from wishlist`}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                >
                  {remove.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}