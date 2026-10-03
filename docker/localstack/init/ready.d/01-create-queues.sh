#!/bin/sh
awslocal sqs create-queue --queue-name wager-events >/dev/null
