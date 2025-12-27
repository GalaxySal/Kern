import { execSync } from 'child_process';

function getChangelog() {
    try {
        // Get the last two tags
        const tags = execSync('git tag --sort=-v:refname | head -n 2').toString().trim().split('\n');

        let range = '';
        if (tags.length === 2) {
            range = `${tags[1]}..${tags[0]}`;
        } else if (tags.length === 1) {
            // First release, get all commits up to this tag
            range = tags[0];
        } else {
            return "Initial release of Kern Editor.";
        }

        // Get commits in range, formatted
        const log = execSync(`git log ${range} --pretty=format:"* %s (%h)" --no-merges`).toString().trim();

        if (!log) return "No changes recorded since last release.";

        return log;
    } catch (error) {
        console.error('Failed to generate changelog:', error.message);
        return "New version of Kern Editor released.";
    }
}

console.log(getChangelog());
