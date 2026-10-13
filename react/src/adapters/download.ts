/** Saves a file the browser already holds (an object URL or a same-origin path) under the given name. */
export function downloadFile(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}