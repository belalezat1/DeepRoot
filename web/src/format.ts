export function authorName(author: string): string {
  return author.split('<')[0].trim() || author;
}

export function formatDate(value: string, short = false): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric' }),
  });
}
