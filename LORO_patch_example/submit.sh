#!/bin/bash

#SBATCH --job-name="d0.095"      # Name of the job in the queue
#SBATCH --error="slurm.%j.err"      # Name of stderr file
#SBATCH --output="slurm.%j.out"     # Name of the stdout file
#SBATCH --partition=gpu-shared   # gpu-shared for jobs using under 4 GPUs
#SBATCH --nodes=1                # Number of full nodes you need
#SBATCH --gpus=1                 # Number of GPUs
#SBATCH --ntasks-per-node=1      # Number of CPUs
#SBATCH --mem=16G                # 16 is plenty unless you're running million-nucleotide simultations
#SBATCH --account=azs139         # Our account number
#SBATCH --export=NONE            # Do not propagate environment variables (will break Python if you don't set this)
#SBATCH -t 48:00:00              # max wall time is 48 hours
#SBATCH --no-requeue             # remove this if you're starting from last_conf

module purge
module load gpu
module load slurm

module load cuda
#module load anaconda3
#source activate oxDNA            # create this environment from the yml file found in the conda page on the wiki

#~/software/oxDNA/build/bin/oxDNA input
#python ~/software/oxdna_analysis_tools/align_trajectory.py trajectory_trap.dat aligned.dat

# run the program
#/home/petr/projects/plpatches/oxdna_latest/bin/oxDNA  input_cold

EXEC="/home/psulc/oxdna-lorenzo/oxDNA/build/bin/oxDNA"
 $EXEC input_KF 

