/**
 * The path shown in the result list: it starts at the searched folder (so results of different folders can be told
 * apart) and uses backslashes, like the paths of TIA Portal. Both arguments are uri paths (forward slashes).
 */
export function displayPath(folderPath: string, filePath: string): string {
  const folder = folderPath.replace(/\/+$/, '');
  const inside = filePath.startsWith(`${folder}/`);
  const relative = inside ? filePath.slice(folder.length) : filePath;
  const name = inside ? folder.slice(folder.lastIndexOf('/') + 1) : '';
  return `${name}${relative.replace(/\//g, '\\')}`;
}
