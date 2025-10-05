import { format, parseISO } from "date-fns";

export function formatDate(dateString) {
  try {
    return format(parseISO(dateString), "MMM dd, yyyy h:mm a");
  } catch {
    return dateString;
  }
}

export function formatDateShort(dateString) {
  try {
    return format(parseISO(dateString), "MMM dd, yyyy");
  } catch {
    return dateString;
  }
}
