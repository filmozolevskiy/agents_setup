import subprocess
import re
import argparse
import os

def filter_cards(search_terms, excluded_lists, agent_tools_dir):
    """
    Robustly filters Trello cards from JSON files in the agent-tools directory.
    Uses line-based chunking to correctly associate name, idList, and url.
    """
    results = {}
    
    # Construct grep command to find cards matching search terms in the "name" field
    terms_regex = "|".join(search_terms)
    grep_cmd = f"grep -nEi '\"name\": \".*({terms_regex}).*\"' {agent_tools_dir}/*.txt"
    
    try:
        output = subprocess.check_output(grep_cmd, shell=True, text=True)
    except subprocess.CalledProcessError:
        return results

    for line in output.splitlines():
        if not line: continue
        
        # Format: filename:linenumber:content
        parts = line.split(':', 2)
        if len(parts) < 3: continue
        
        filename = parts[0]
        line_num = int(parts[1])
        
        # Read a chunk of lines around the match to find idList and url
        # 100 lines before and after is usually enough for a Trello card object
        start = max(1, line_num - 100)
        end = line_num + 100
        
        try:
            chunk_cmd = f"sed -n '{start},{end}p' \"{filename}\""
            chunk = subprocess.check_output(chunk_cmd, shell=True, text=True)
            
            # Extract the card name from the current line
            name_match = re.search(r'"name": "([^"]+)"', line)
            if not name_match: continue
            name = name_match.group(1)
            
            # Find all idList and url/shortUrl occurrences in the chunk
            list_matches = list(re.finditer(r'"idList": "([^"]+)"', chunk))
            url_matches = list(re.finditer(r'"url": "(https://trello.com/c/[^"]+)"', chunk))
            if not url_matches:
                url_matches = list(re.finditer(r'"shortUrl": "(https://trello.com/c/[^"]+)"', chunk))
            
            if not list_matches or not url_matches: continue
            
            # Find the name's position in the chunk to associate the closest fields
            name_pos = chunk.find(f'"name": "{name}"')
            
            # Closest idList before name
            best_id_list = None
            for m in list_matches:
                if m.start() < name_pos:
                    best_id_list = m.group(1)
                else:
                    break
            if not best_id_list: best_id_list = list_matches[0].group(1)
            
            # Closest url after name
            best_url = None
            for m in url_matches:
                if m.start() > name_pos:
                    best_url = m.group(1)
                    break
            if not best_url: best_url = url_matches[-1].group(1)
            
            if best_url and best_id_list:
                # Use the shortUrl (without slug) as key to avoid duplicates
                short_url_match = re.search(r'https://trello.com/c/[^/]+', best_url)
                short_url = short_url_match.group(0) if short_url_match else best_url
                
                if best_id_list not in excluded_lists:
                    results[short_url] = (name, best_url)
        except Exception:
            continue
            
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Filter Trello cards from agent-tools JSON files.")
    parser.add_argument("--terms", nargs="+", required=True, help="Search terms (case-insensitive)")
    parser.add_argument("--exclude", nargs="*", default=[], help="List IDs to exclude")
    parser.add_argument("--dir", default="/Users/filippmozolevskiy/.cursor/projects/Users-filippmozolevskiy-Repositories-agents-setup/agent-tools", help="Directory containing .txt files")
    
    args = parser.parse_args()
    
    filtered_results = filter_cards(args.terms, args.exclude, args.dir)
    
    for short_url, (name, full_url) in sorted(filtered_results.items(), key=lambda x: x[1][0]):
        print(f"{name} | {full_url}")
