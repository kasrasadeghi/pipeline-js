tmux new-session -d -s pipeline-debug
tmux send-keys -t pipeline-debug "make simple" Enter
tmux split-window -h -t pipeline-debug
tmux send-keys -t pipeline-debug "make proxy" Enter
tmux set-option -s pipeline-debug history-limit 10000 
tmux attach
