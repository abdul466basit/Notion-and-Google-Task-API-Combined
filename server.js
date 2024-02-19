const express = require('express');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const bodyParser = require('body-parser');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = 4001;

const notion = new Client({ auth: "secret_dTkoxyUdb4jBuVtIectcodxhJJSjSFIZPgK8qaYopgH" });
const databaseID = '65afb8f7158c45b5b210514bd2f0fb86';

app.listen(PORT, () => {
    console.log('Server listening on Port: ' + PORT);
});

// Function to authenticate with Google Tasks API and retrieve tasks
async function listTasks() {

    const client = await loadSavedCredentialsIfExist();
    if (!client) {
        console.error('Authentication failed');
        return;
    }

    const service = google.tasks({ version: 'v1', auth: client });

    const taskLists = await service.tasklists.list({
        maxResults: 1, // Retrieve the first task list
    });

    if (taskLists.data.items && taskLists.data.items.length > 0) {
        const firstTaskListId = taskLists.data.items[0].id;

        const tasks = await service.tasks.list({
            tasklist: firstTaskListId,
        });

        const taskItems = tasks.data.items;

        if (taskItems && taskItems.length > 0) {
            // Call the function to send data to Notion here
            sendTasksToNotion(taskItems);
        } else {
            console.log('No tasks found in the first task list.');
        }
    } else {
        console.log('No task lists found.');
    }
}

async function authorize() {
    const SCOPES = ['https://www.googleapis.com/auth/tasks.readonly'];
    const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
  
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
  
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
  
    if (client.credentials) {
      await saveCredentials(client);
    }
  
    return client;
}
  
async function loadProcessedTasks() {
    const PROCESSED_TASKS_PATH = path.join(process.cwd(), 'processedTasks.json');
    try {
        const content = await fs.readFile(PROCESSED_TASKS_PATH);
        return JSON.parse(content);
    } catch (err) {
        return [];
    }
}

async function saveProcessedTask(taskId) {
    const PROCESSED_TASKS_PATH = path.join(process.cwd(), 'processedTasks.json');
    let processedTasks = await loadProcessedTasks();
    processedTasks.push(taskId);
    await fs.writeFile(PROCESSED_TASKS_PATH, JSON.stringify(processedTasks));
}

// Read previously authorized credentials from the save file
async function loadSavedCredentialsIfExist() {
    const TOKEN_PATH = path.join(process.cwd(), 'token.json');
    
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

// Serialize credentials to a file compatible with google.auth.fromJSON
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

async function sendTasksToNotion(tasks) {
    for (const task of tasks) {
        const { id, title, notes, due } = task;

        // Check if the task has already been processed
        const processedTasks = await loadProcessedTasks();
        if (processedTasks.includes(id)) {
            console.log(`Task with ID ${id} has already been processed. Skipping.`);
            continue;
        }

        try {
            const response = await notion.pages.create({
                parent: { database_id: databaseID },
                properties: {
                    Title: { title: [{ text: { content: title } }] },
                    Details: { rich_text: [{ text: { content: notes || 'No details available' } }] },
                    DueDate: { rich_text: [{ text: { content: due ? new Date(due).toLocaleString() : 'No due date' } }] },
                },
            });
            console.log("Successfully Added Task to the Notion Database...");

            await saveProcessedTask(id);
        } catch (error) {
            console.log(error);
        }
    }
}

// Set to check for the new tasks after every 10 mins
cron.schedule('*/10 * * * *', async () => {
    console.log('Running scheduled task...');
    try {
        const authClient = await authorize();
        if (authClient) {
            await listTasks(authClient);
        }
    } catch (error) {
        console.error('Error during scheduled task:', error);
    }
});
